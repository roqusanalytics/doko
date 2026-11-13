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
    const { stop } = recognizeScannedPages(bus, viewer, ["eng"], () => {});
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
  const search = await page.evaluate(async () => {
    const { OcrFindController } = await import("/src/OcrFindController.ts");
    const { EventBus } = await import("/src/viewer.ts");
    const bus = new EventBus(), failures = [], totals = [];
    const text = str => ({ items: [{ str, hasEOL: false }], styles: {}, lang: null });
    const pdf = { getPage: async () => ({ getTextContent: async () => text("") }) };
    const controller = new OcrFindController({ eventBus: bus, linkService: { page: 1, pagesCount: 1 }, delay: 0 });
    bus.on("searchtexterror", event => failures.push(event.message));
    bus.on("updatefindmatchescount", event => totals.push(event.matchesCount.total));
    bus.on("updatefindcontrolstate", event => totals.push(event.matchesCount.total));
    const find = query => bus.dispatch("find", { type: "again", query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false, matchDiacritics: false });
    const until = async (test, message) => {
      for (let i = 0; i < 200; i++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
      throw new Error(message);
    };
    let reads = 0;
    controller.setTextReader(pdf, async () => { reads++; return text("Reference 7319"); });
    controller.setDocument(pdf); // The viewer does this after pagesinit and the first render.
    find("");
    find("   ");
    await new Promise(resolve => setTimeout(resolve, 20));
    if (reads) throw new Error("Empty query scanned pages");
    find("7319");
    await until(() => controller.pageMatches[0]?.length === 1, "Late viewer setDocument lost OCR reader");
    controller.setTextReader(pdf, async () => text("Replacement 8426"));
    await until(() => controller.pageMatches[0]?.length === 0, "Language restart kept old matches");
    find("8426");
    await until(() => controller.pageMatches[0]?.length === 1, "Language restart did not resume matching");
    if ((await controller.getPageText(1)).items[0].str !== "Replacement 8426") throw new Error("Snippet reader stale");
    let attempts = 0;
    controller.setTextReader(pdf, async () => {
      if (++attempts === 1) throw new Error("Synthetic scan failure");
      return text("Recovered 8426");
    });
    await until(() => failures.length === 1, "Scan failure hidden");
    find("8426");
    await until(() => controller.pageMatches[0]?.length === 1, "Failed search did not retry");
    let release;
    controller.setTextReader(pdf, () => new Promise(resolve => { release = resolve; }));
    await until(() => !!release, "Pending OCR did not begin");
    bus.dispatch("findbarclose", {});
    controller.setTextReader(pdf, async () => text("New 8426"));
    find("8426");
    await until(() => controller.pageMatches[0]?.length === 1, "Reopened search did not match");
    totals.length = 0;
    release(text("Old 8426"));
    await new Promise(resolve => setTimeout(resolve, 20));
    if (totals.some(total => total > 1)) throw new Error("Old OCR doubled reopened search count");
    bus.dispatch("findbarclose", {});
    if (controller.pageMatches.length || controller.highlightMatches) throw new Error("Closed search kept matches");
    let loads = 0;
    const flaky = { getPage: async () => {
      if (++loads === 1) throw new Error("Synthetic page load failure");
      return { getTextContent: async () => text("Recovered page") };
    } };
    controller.setDocument(flaky);
    find("Recovered");
    await until(() => failures.length === 2, "Page load failure hidden");
    find("Recovered");
    await until(() => controller.pageMatches[0]?.length === 1, "Page load failure did not retry");
    const native = { getPage: async () => ({ getTextContent: async () => text("Native text") }) };
    controller.setDocument(native);
    find("Native");
    await until(() => controller.pageMatches[0]?.length === 1, "New document retained old reader");
    bus.dispatch("findbarclose", {});
    const rejectedAsAbort = async promise => {
      try { await promise; } catch (error) { if (error.name === "AbortError") return; throw error; }
      throw new Error("Stale document text was accepted");
    };
    await rejectedAsAbort(controller.getPageText(1, pdf));
    let finishText;
    controller.setTextReader(native, () => new Promise(resolve => { finishText = resolve; }));
    const pendingText = controller.getPageText(1, native);
    await until(() => !!finishText, "AI text read did not begin");
    controller.setTextReader(native, async () => text("New language text"));
    finishText(text("Old language text"));
    await rejectedAsAbort(pendingText);
    if ((await controller.getPageText(1, native)).items[0].str !== "New language text") throw new Error("Fresh AI text reader unavailable");
    controller.setDocument(null);
    await rejectedAsAbort(controller.getPageText(1, native));
    return { reads, attempts, failures: failures.length, loads };
  });
  assert.deepEqual(search, { reads: 1, attempts: 2, failures: 2, loads: 2 });
  await assertHidden(app);
  console.log("PASS real OCR worker: failed language init and cancellation terminate; fresh retry recognizes synthetic text; million-page queue bounded; search empty/language restart/failure retry/close/document lifecycle");
} finally {
  if (app) await closeHidden(app);
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
