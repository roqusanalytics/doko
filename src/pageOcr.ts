import { AnnotationMode, OPS, type PDFPageProxy } from "pdfjs-dist";
import type { PageOcrWorker } from "./ocrWorker";
import { SCAN_LANGUAGES, type ScanLanguage } from "./scanLanguage";
import { installedScanLanguages, OCR_CACHE_PATH } from "./scanLanguagePacks";
import type { EventBus, PDFPageView, PDFViewer } from "./viewer";

interface Word {
  text: string;
  left: number;
  top: number;
  height: number;
  scaleX: number;
  endOfLine: boolean;
}

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat,
]);

async function hasPageImage(page: PDFPageProxy) {
  if (page.imageCoordinates?.length) return true;
  // pdf.js records locations for ordinary images but not for stencil masks used by some monochrome scans.
  const { fnArray } = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  return fnArray.some(op => IMAGE_OPS.has(op));
}

async function startWorker(languages: ScanLanguage[], signal: AbortSignal) {
  if (languages.some(code => code !== "eng")) {
    const installed = await installedScanLanguages();
    const missing = SCAN_LANGUAGES.find(({ id }) => languages.includes(id) && !installed.has(id));
    if (missing) throw new MissingScanPack(`Download the ${missing.name} pack in Settings to read this scan.`);
  }
  const { startOcrWorker } = await import("./ocrWorker");
  const base = `${import.meta.env.BASE_URL}ocr`;
  return startOcrWorker(base, languages, OCR_CACHE_PATH, signal);
}

class MissingScanPack extends Error {}

async function readWords(page: PDFPageProxy, worker: PageOcrWorker, signal: AbortSignal): Promise<Word[]> {
  signal.throwIfAborted();
  // Read at a consistent resolution even in fit-page mode. Bound both dimensions on oversized scans.
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2400 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const render = page.render({ canvas, viewport });
  const cancel = () => render.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await render.promise;
    signal.throwIfAborted();
    // A language switch or document close can terminate the worker during image encoding.
    // Encode here so we can check ownership before Tesseract posts its recognition job.
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't prepare the scan image."));
    }));
    signal.throwIfAborted();
    const bytes = new Uint8Array(await png.arrayBuffer());
    signal.throwIfAborted();
    const { data } = await worker.recognize(bytes);
    signal.throwIfAborted();
    const ctx = canvas.getContext("2d")!;
    ctx.font = "100px sans-serif";
    const [xMin, yMin, xMax, yMax] = page.view;
    const words: Word[] = [];
    const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(p => p.lines));
    for (const line of lines) {
      const height = line.bbox.y1 - line.bbox.y0;
      for (const [i, word] of line.words.entries()) {
        const width = ctx.measureText(word.text).width;
        if (!width || !height) continue;
        // pdf.js sizes its text layer in unrotated PDF units and rotates the whole layer for display.
        const [x, y] = viewport.convertToPdfPoint(word.bbox.x0, line.bbox.y0);
        words.push({
          text: word.text, endOfLine: i === line.words.length - 1,
          left: 100 * (x - xMin) / (xMax - xMin), top: 100 * (yMax - y) / (yMax - yMin),
          height: height / (scale * page.userUnit), scaleX: 100 * (word.bbox.x1 - word.bbox.x0) / (width * height),
        });
      }
    }
    return words;
  } finally {
    signal.removeEventListener("abort", cancel);
    canvas.width = canvas.height = 0;
  }
}

function addWords(view: PDFPageView, words: Word[]) {
  const layer = view.textLayer?.div;
  const end = layer?.querySelector(":scope > .endOfContent");
  if (!end || layer?.textContent.trim()) return;
  const fragment = document.createDocumentFragment();
  let lineStart = true;
  for (const word of words) {
    const span = document.createElement("span");
    span.className = lineStart ? "ocr-word ocr-line-start" : "ocr-word";
    span.textContent = word.text + (word.endOfLine ? "" : " ");
    span.style.left = `${word.left}%`;
    span.style.top = `${word.top}%`;
    span.style.fontFamily = "sans-serif";
    span.style.setProperty("--font-height", `${word.height}px`);
    span.style.setProperty("--scale-x", String(word.scaleX));
    span.style.setProperty("--rotate", `${-view.pdfPage.rotate}deg`);
    fragment.append(span);
    if (word.endOfLine) {
      const br = document.createElement("br");
      br.className = "ocr-break";
      fragment.append(br);
    }
    lineStart = word.endOfLine;
  }
  end.before(fragment);
}

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
    try {
      page = await pdf.getPage(n);
      signal.throwIfAborted();
      if (await hasEmbeddedText(page, signal)) return;
      signal.throwIfAborted();
      if (!(await hasPageImage(page))) return;
      signal.throwIfAborted();
      if (n !== viewer.currentPageNumber && pending.has(viewer.currentPageNumber)) {
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
        remember(n, words);
        addWords(view, words);
      } else {
        notices.set(n, "noWords");
      }
    } catch (error) {
      if (!signal.aborted) {
        notices.set(n, "ocrError");
        console.warn("Page OCR failed", error);
      }
    } finally {
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
    else if (view.textLayer?.div.textContent.trim() && !view.textLayer.div.querySelector(".ocr-word")) {
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
  return () => {
    controller.abort();
    window.clearTimeout(timer);
    cache.clear();
    pending.clear();
    // A language change replaces only the text Doko added to the open document.
    // In one-page scrolling mode some rendered layers are detached from the viewer.
    for (const view of viewer.getCachedPageViews() as Set<PDFPageView>) {
      view.textLayer?.div.querySelectorAll(".ocr-word, .ocr-break").forEach(node => node.remove());
    }
    onStatus(null);
  };
}
