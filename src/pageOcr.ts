import type { PDFPageProxy } from "pdfjs-dist";
import type { PageOcrWorker } from "./ocrWorker";
import type { ScanLanguage } from "./scanLanguage";
import type { EventBus, PDFPageView, PDFViewer } from "./viewer";
import { addWords, hasPageImage, readWords, startWorker, wordStrings, prepareOcrHighlighter, MissingScanPack, type Word } from "./ocrPageText";
import type { PageText } from "./OcrFindController";

/** Consume the stream one chunk at a time without retaining a whole page's text and fonts. */
async function hasEmbeddedText(page: PDFPageProxy, signal: AbortSignal) {
  const reader = page.streamTextContent().getReader();
  let found = false;
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return found;
      found ||= value.items.some((item: { str?: string }) => item.str?.trim());
    }
    throw signal.reason;
  } finally {
    reader.releaseLock();
  }
}

/** Prepare only the current page and its successor; distant scans wait until the reader visits them. */
export function recognizeScannedPages(bus: EventBus, viewer: PDFViewer, languages: ScanLanguage[], onStatus: (text: string | null) => void) {
  const pdf = viewer.pdfDocument!;
  const controller = new AbortController();
  const { signal } = controller;
  const pending = new Set<number>();
  const prepared = new Set<number>();
  const requests = new Map<number, { promise: Promise<Word[]>; resolve: (words: Word[]) => void; reject: (error: unknown) => void }>();
  // Keep small documents ready for the entire session. On huge scans, evicted pages can be read again on demand.
  const cache = new Map<number, Word[]>();
  const notices = new Map<number, "noWords" | "ocrError" | "layerError">();
  let cachedWords = 0;
  let active = 0;
  let recognizing = false;
  let timer: number | undefined;
  let worker: Promise<PageOcrWorker> | undefined;
  let workerStartFailed = false;
  let missingPackMessage: string | undefined;

  function updateStatus() {
    const n = viewer.currentPageNumber;
    const view: PDFPageView = viewer.getPageView(n - 1);
    const layer = view.textLayer?.div;
    if (layer?.isConnected && !layer.hidden && layer.textContent.trim()) onStatus(null);
    else if (notices.get(n) === "noWords") onStatus(`No readable text found on page ${n}.`);
    else if (notices.has(n)) onStatus(missingPackMessage ?? `Text unavailable on page ${n}.`);
    else if (active === n && recognizing) onStatus(`Recognizing text on page ${n}…`);
    else if (pending.has(n) || active === n || !layer?.isConnected || layer.hidden || !layer.querySelector(".endOfContent")) {
      onStatus(`Preparing text on page ${n}…`);
    } else onStatus(null);
  }

  function remember(n: number, words: Word[]) {
    cache.set(n, words);
    cachedWords += words.length;
    for (const [old, entry] of cache) {
      if (cachedWords <= 100_000) break;
      if (old === n || Math.abs(old - viewer.currentPageNumber) <= 1) continue;
      cache.delete(old);
      cachedWords -= entry.length;
      prepared.delete(old);
    }
  }

  function queueVisible() {
    pending.clear();
    for (const n of [viewer.currentPageNumber, viewer.currentPageNumber + 1]) {
      if (n <= pdf.numPages && n !== active && !prepared.has(n)) pending.add(n);
    }
    for (const n of requests.keys()) if (n !== active) pending.add(n);
  }

  function schedule() {
    if (!signal.aborted && !window.frameElement?.hasAttribute("inert") && !active && timer === undefined && pending.size) {
      timer = window.setTimeout(prepareNext, 0);
    }
  }

  async function prepareNext() {
    timer = undefined;
    if (!pending.size || signal.aborted || window.frameElement?.hasAttribute("inert")) return;
    const n = pending.has(viewer.currentPageNumber) ? viewer.currentPageNumber : pending.values().next().value!;
    pending.delete(n);
    prepared.add(n);
    active = n;
    const view: PDFPageView = viewer.getPageView(n - 1);
    let page: PDFPageProxy | undefined;
    let failure: unknown;
    try {
      page = await pdf.getPage(n);
      signal.throwIfAborted();
      if (await hasEmbeddedText(page, signal)) return;
      signal.throwIfAborted();
      if (!(await hasPageImage(page))) return;
      signal.throwIfAborted();
      if (n !== viewer.currentPageNumber && pending.has(viewer.currentPageNumber) && !requests.has(n)) {
        prepared.delete(n);
        return;
      }
      recognizing = true;
      if (n === viewer.currentPageNumber) updateStatus();
      worker ??= startWorker(languages, signal).catch(error => {
        workerStartFailed = true;
        missingPackMessage = error instanceof MissingScanPack ? error.message : undefined;
        throw error;
      });
      const activeWorker = await worker;
      let words: Word[];
      try { words = await readWords(page, activeWorker, signal); }
      catch (error) { if (activeWorker.stopped) workerStartFailed = true; throw error; }
      signal.throwIfAborted();
      if (words.length) {
        prepareOcrHighlighter(view);
        remember(n, words);
        addWords(view, words);
      } else {
        notices.set(n, "noWords");
      }
    } catch (error) {
      failure = error;
      if (!signal.aborted) {
        notices.set(n, "ocrError");
        console.warn("Page OCR failed", error);
      }
    } finally {
      const request = requests.get(n);
      requests.delete(n);
      if (failure) request?.reject(failure);
      else request?.resolve(cache.get(n) ?? []);
      active = 0;
      recognizing = false;
      if (!signal.aborted) {
        // Background renders aren't in the viewer's page buffer, so it won't release their images for us.
        if (!viewer.getCachedPageViews().has(view)) page?.cleanup();
        if (n === viewer.currentPageNumber) updateStatus();
        queueVisible();
        schedule();
      }
    }
  }

  bus.on("textlayerrendered", ({ source: view, pageNumber: n, error }: { source: PDFPageView; pageNumber: number; error: unknown }) => {
    if (error) {
      notices.set(n, "layerError");
      if (n === viewer.currentPageNumber) updateStatus();
      return;
    }
    if (notices.get(n) === "layerError") notices.delete(n);
    const words = cache.get(n);
    if (words) addWords(view, words);
    else if (view.textLayer?.div.textContent.trim() && !view.textLayer.div.querySelector("[data-ocr-word]")) {
      prepared.add(n);
      pending.delete(n);
    }
    else if ((n === viewer.currentPageNumber || n === viewer.currentPageNumber + 1) && !prepared.has(n) && n !== active) pending.add(n);
    if (n === viewer.currentPageNumber) updateStatus();
    schedule();
  }, { signal });
  bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
    if (notices.get(pageNumber) === "ocrError") {
      notices.delete(pageNumber);
      if (workerStartFailed) { worker = undefined; workerStartFailed = false; }
      prepared.delete(pageNumber);
    }
    queueVisible();
    updateStatus();
    schedule();
  }, { signal });
  window.addEventListener("folio:tab-visibility", schedule, { signal });
  queueVisible();
  updateStatus();
  schedule();
  const stop = () => {
    controller.abort();
    window.clearTimeout(timer);
    cache.clear();
    pending.clear();
    for (const request of requests.values()) request.reject(signal.reason);
    requests.clear();
    // A language change replaces only the text Doko added to the open document.
    // In one-page scrolling mode some rendered layers are detached from the viewer.
    for (const view of viewer.getCachedPageViews() as Set<PDFPageView>) {
      const layer = view.textLayer;
      if (!layer?.div.querySelector("[data-ocr-word]")) continue;
      layer.highlighter?.disable();
      layer.highlighter?.setTextMapping([], []);
      layer.div.querySelectorAll("[data-ocr-word], .ocr-break").forEach(node => node.remove());
    }
    onStatus(null);
  };
  const getTextContent = async (page: PDFPageProxy): Promise<PageText> => {
    signal.throwIfAborted();
    const text = await page.getTextContent({ disableNormalization: true });
    signal.throwIfAborted();
    if (text.items.some(item => "str" in item && item.str.trim())) return text;
    const n = page.pageNumber;
    let words = cache.get(n);
    if (!words && (!prepared.has(n) || active === n || notices.get(n) === "ocrError")) {
      let request = requests.get(n);
      if (!request) {
        let resolve!: (words: Word[]) => void, reject!: (error: unknown) => void;
        const promise = new Promise<Word[]>((yes, no) => { resolve = yes; reject = no; });
        request = { promise, resolve, reject };
        requests.set(n, request);
        // The next search is a deliberate retry after a failed page/worker.
        if (notices.get(n) === "ocrError") {
          notices.delete(n);
          prepared.delete(n);
          if (workerStartFailed) { worker = undefined; workerStartFailed = false; }
        }
        if (n !== active) pending.add(n);
        schedule();
      }
      words = await request.promise;
    }
    const strings = wordStrings(words ?? []);
    return { ...text, items: strings.map(str => ({ str, dir: "ltr", transform: [], width: 0, height: 0, fontName: "", hasEOL: false })) };
  };
  return { stop, getTextContent };
}
