import assert from "node:assert/strict";
import { test } from "node:test";
import { startOcrWorker } from "../src/ocrWorker.ts";

class FakeWorker {
  static workers = [];
  static fail;
  static pause;
  packets = [];
  terminated = 0;
  constructor(url) {
    this.url = url;
    FakeWorker.workers.push(this);
  }
  postMessage(packet) {
    this.packets.push(packet);
    if (packet.action === FakeWorker.pause) return;
    queueMicrotask(() => this.onmessage({ data: {
      ...packet,
      status: packet.action === FakeWorker.fail ? "reject" : "resolve",
      data: packet.action === FakeWorker.fail ? "Synthetic OCR failure" : { blocks: [{ text: "Read again" }] },
    } }));
  }
  terminate() { this.terminated++; }
}

test("OCR owns and terminates its physical worker throughout initialization", async t => {
  const previousWorker = globalThis.Worker;
  const previousWindow = globalThis.window;
  globalThis.Worker = FakeWorker;
  globalThis.window = { location: { href: "https://doko.test/reader/index.html" } };
  try {
    for (const action of ["load", "loadLanguage", "initialize", "setParameters"]) {
      await t.test(`${action} failure terminates and a fresh retry reads text`, async () => {
        FakeWorker.fail = action;
        const failedController = new AbortController();
        await assert.rejects(startOcrWorker("/ocr", ["eng"], "cache", failedController.signal), /Synthetic OCR failure/);
        const failed = FakeWorker.workers.at(-1);
        assert.equal(failed.terminated, 1);
        assert.equal(failed.packets.at(-1).action, action);
        failedController.abort();
        assert.equal(failed.terminated, 1);
        FakeWorker.fail = undefined;
        const retryController = new AbortController();
        const retry = await startOcrWorker("/ocr", ["eng"], "cache", retryController.signal);
        const native = FakeWorker.workers.at(-1);
        assert.equal(native.url, "https://doko.test/ocr/worker.min.js");
        assert.deepEqual(native.packets.map(p => p.action), ["load", "loadLanguage", "initialize", "setParameters"]);
        const result = await retry.recognize(new Uint8Array([1, 2]));
        assert.equal(result.data.blocks[0].text, "Read again");
        retryController.abort();
        assert.equal(native.terminated, 1);
      });
      await t.test(`abort during ${action} terminates without waiting for initialization`, async () => {
        FakeWorker.pause = action;
        const controller = new AbortController();
        const started = startOcrWorker("/ocr", ["eng"], "cache", controller.signal);
        const rejection = assert.rejects(started, { name: "AbortError" });
        await new Promise(resolve => setImmediate(resolve));
        const native = FakeWorker.workers.at(-1);
        assert.equal(native.packets.at(-1).action, action);
        controller.abort();
        assert.equal(native.terminated, 1);
        await rejection;
        assert.equal(native.packets.at(-1).action, action);
        FakeWorker.pause = undefined;
      });
    }
    await t.test("abort during recognition rejects the pending job and stops the worker", async () => {
      const controller = new AbortController();
      const ready = await startOcrWorker("/ocr", ["eng"], "cache", controller.signal);
      FakeWorker.pause = "recognize";
      const rejection = assert.rejects(ready.recognize(new Uint8Array()), { name: "AbortError" });
      controller.abort();
      await rejection;
      assert.equal(FakeWorker.workers.at(-1).terminated, 1);
      FakeWorker.pause = undefined;
    });
    await t.test("recognition rejection releases its job so the same worker can retry", async () => {
      const controller = new AbortController();
      const ready = await startOcrWorker("/ocr", ["eng"], "cache", controller.signal);
      FakeWorker.fail = "recognize";
      await assert.rejects(ready.recognize(new Uint8Array()), /Synthetic OCR failure/);
      FakeWorker.fail = undefined;
      const result = await ready.recognize(new Uint8Array());
      assert.equal(result.data.blocks[0].text, "Read again");
      assert.equal(typeof result.jobId, "string");
      controller.abort();
      assert.equal(FakeWorker.workers.at(-1).terminated, 1);
    });
    await t.test("a native crash after initialization marks the worker stopped and a fresh worker retries", async () => {
      const controller = new AbortController();
      const ready = await startOcrWorker("/ocr", ["eng"], "cache", controller.signal);
      assert.equal(ready.stopped, false);
      FakeWorker.pause = "recognize";
      const pending = ready.recognize(new Uint8Array([1]));
      const rejected = assert.rejects(pending, /Synthetic runtime crash/);
      const native = FakeWorker.workers.at(-1);
      native.onerror({ message: "Synthetic runtime crash" });
      await rejected;
      assert.equal(ready.stopped, true);
      assert.equal(native.terminated, 1);
      FakeWorker.pause = undefined;
      const retry = await startOcrWorker("/ocr", ["eng"], "cache", controller.signal);
      assert.equal((await retry.recognize(new Uint8Array([1]))).data.blocks[0].text, "Read again");
      controller.abort();
    });
    await t.test("native worker errors reject initialization and terminate", async () => {
      FakeWorker.pause = "load";
      const controller = new AbortController();
      const started = startOcrWorker("/ocr", ["eng"], "cache", controller.signal);
      FakeWorker.workers.at(-1).onerror({ message: "Couldn't load OCR core" });
      await assert.rejects(started, /Couldn't load OCR core/);
      assert.equal(FakeWorker.workers.at(-1).terminated, 1);
      FakeWorker.pause = undefined;
    });
    await t.test("a stalled initialization times out and terminates its physical worker", async () => {
      const previousTimeout = globalThis.setTimeout;
      const previousClearTimeout = globalThis.clearTimeout;
      let expire;
      let cleared = false;
      globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 60_000); expire = callback; return 123; };
      globalThis.clearTimeout = timer => { assert.equal(timer, 123); cleared = true; };
      FakeWorker.pause = "loadLanguage";
      try {
        const started = startOcrWorker("/ocr", ["eng"], "cache", new AbortController().signal);
        const rejection = assert.rejects(started, /OCR initialization timed out/);
        await new Promise(resolve => setImmediate(resolve));
        const native = FakeWorker.workers.at(-1);
        assert.equal(native.packets.at(-1).action, "loadLanguage");
        expire();
        assert.equal(native.terminated, 1);
        await rejection;
        assert.equal(cleared, true);
      } finally {
        FakeWorker.pause = undefined;
        globalThis.setTimeout = previousTimeout;
        globalThis.clearTimeout = previousClearTimeout;
      }
    });
    await t.test("already aborted requests never create a worker", async () => {
      const controller = new AbortController();
      controller.abort();
      const count = FakeWorker.workers.length;
      await assert.rejects(startOcrWorker("/ocr", ["eng"], "cache", controller.signal), { name: "AbortError" });
      assert.equal(FakeWorker.workers.length, count);
    });
  } finally {
    globalThis.Worker = previousWorker;
    globalThis.window = previousWindow;
  }
});
