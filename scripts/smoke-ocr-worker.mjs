import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-ocr-worker-"));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
let app;
try {
  await server.listen();
  const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1", FOLIO_DEV_URL: server.resolvedUrls.local[0] };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
  const page = readerPage(await app.firstWindow());
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const { startOcrWorker } = await import("/src/ocrWorker.ts");
    const NativeWorker = window.Worker;
    const workers = [];
    window.Worker = class extends NativeWorker {
      terminated = 0;
      constructor(...args) { super(...args); workers.push(this); }
      terminate() { this.terminated++; super.terminate(); }
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      let failed = false;
      try { await startOcrWorker("/ocr", ["not-a-real-language"], "doko-ocr-test", controller.signal); }
      catch { failed = true; }
      if (!failed || workers[0]?.terminated !== 1) throw new Error("Failed initialization retained its worker");
      const cancelled = new AbortController();
      const starting = startOcrWorker("/ocr", ["eng"], "doko-ocr-test", cancelled.signal);
      cancelled.abort();
      try { await starting; throw new Error("Aborted initialization succeeded"); }
      catch (error) { if (error.name !== "AbortError") throw error; }
      if (workers[1]?.terminated !== 1) throw new Error("Aborted initialization retained its worker");
      const ready = await startOcrWorker("/ocr", ["eng"], "doko-ocr-test", controller.signal);
      const canvas = Object.assign(document.createElement("canvas"), { width: 1200, height: 240 });
      const context = canvas.getContext("2d");
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "black"; context.font = "72px sans-serif";
      context.fillText("OCR WORKER RETRY", 40, 130);
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      const { data } = await ready.recognize(new Uint8Array(await blob.arrayBuffer()));
      const text = (data.blocks ?? []).map(block => block.text).join(" ");
      controller.abort();
      return { text, terminations: workers.map(worker => worker.terminated) };
    } finally {
      clearTimeout(timeout);
      controller.abort();
      workers.forEach(worker => { if (!worker.terminated) worker.terminate(); });
      window.Worker = NativeWorker;
    }
  });
  assert.match(result.text, /OCR WORKER RETRY/);
  assert.deepEqual(result.terminations, [1, 1, 1]);
  const queued = await page.evaluate(async () => {
    const { recognizeScannedPages } = await import("/src/pageOcr.ts");
    const listeners = new Map(), visited = [];
    const bus = { on(name, callback) { listeners.set(name, callback); } };
    const viewer = {
      currentPageNumber: 1,
      pdfDocument: { numPages: 1_000_000, async getPage(n) {
        visited.push(n);
        return { streamTextContent() { return new ReadableStream({ start(controller) {
          controller.enqueue({ items: [{ str: "Embedded text" }] }); controller.close();
        } }); }, cleanup() {} };
      } },
      getPageView() { return {}; }, getCachedPageViews() { return new Set(); },
    };
    const stop = recognizeScannedPages(bus, viewer, ["eng"], () => {});
    try {
      await new Promise(resolve => setTimeout(resolve, 80));
      const initial = [...visited];
      viewer.currentPageNumber = 900_000;
      listeners.get("pagechanging")({ pageNumber: viewer.currentPageNumber });
      await new Promise(resolve => setTimeout(resolve, 80));
      listeners.get("textlayerrendered")({ source: {}, pageNumber: viewer.currentPageNumber - 1 });
      await new Promise(resolve => setTimeout(resolve, 80));
      return { initial, visited };
    } finally { stop(); }
  });
  assert.deepEqual(queued.initial, [1, 2], "OCR should only prepare the visible page and successor");
  assert.deepEqual(queued.visited, [1, 2, 900_000, 900_001], "distant jumps and previous-page layer events must not scan pages outside current+successor");
  await assertHidden(app);
  console.log("PASS real OCR worker: failed language init and cancellation terminate; fresh retry recognizes synthetic text; hidden isolated app; million-page queue prepares only current page and successor");
} finally {
  if (app) await closeHidden(app);
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
