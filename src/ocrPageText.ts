import { AnnotationMode, OPS, type PDFPageProxy } from "pdfjs-dist";
import type { PageOcrWorker } from "./ocrWorker";
import { SCAN_LANGUAGES, type ScanLanguage } from "./scanLanguage";
import { installedScanLanguages, OCR_CACHE_PATH } from "./scanLanguagePacks";
import type { PDFPageView } from "./viewer";

export interface Word {
  text: string;
  left: number;
  top: number;
  height: number;
  width: number;
  scaleX: number;
  endOfLine: boolean;
}

const guardedHighlighters = new WeakSet<object>();

export function prepareOcrHighlighter(view: PDFPageView) {
  const highlighter = view._textHighlighter;
  if (!highlighter || guardedHighlighters.has(highlighter)) return;
  guardedHighlighters.add(highlighter);
  highlighter.findController = new Proxy(highlighter.findController, { get(target, key) {
    // PDF.js enables a new native text layer before Doko can populate its OCR mapping.
    if (key === "pageMatches" && !highlighter.textDivs?.[0]?.hasAttribute?.("data-ocr-word")) return [];
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat,
]);

export async function hasPageImage(page: PDFPageProxy) {
  if (page.imageCoordinates?.length) return true;
  // pdf.js records locations for ordinary images but not for stencil masks used by some monochrome scans.
  const { fnArray } = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  return fnArray.some(op => IMAGE_OPS.has(op));
}

export async function startWorker(languages: ScanLanguage[], signal: AbortSignal) {
  if (languages.some(code => code !== "eng")) {
    const installed = await installedScanLanguages();
    const missing = SCAN_LANGUAGES.find(({ id }) => languages.includes(id) && !installed.has(id));
    if (missing) throw new MissingScanPack(`Download the ${missing.name} pack in Settings to read this scan.`);
  }
  const { startOcrWorker } = await import("./ocrWorker");
  const base = `${import.meta.env.BASE_URL}ocr`;
  return startOcrWorker(base, languages, OCR_CACHE_PATH, signal);
}

export class MissingScanPack extends Error {}

export async function readWords(page: PDFPageProxy, worker: PageOcrWorker, signal: AbortSignal): Promise<Word[]> {
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
          width: width * height / (100 * scale * page.userUnit),
        });
      }
    }
    return words;
  } finally {
    signal.removeEventListener("abort", cancel);
    canvas.width = canvas.height = 0;
  }
}

export function addWords(view: PDFPageView, words: Word[]) {
  const layer = view.textLayer?.div;
  const end = layer?.querySelector(":scope > .endOfContent");
  if (!end || layer?.textContent.trim()) return;
  const spans: HTMLSpanElement[] = [];
  const strings = wordStrings(words);
  const fragment = document.createDocumentFragment();
  let lineStart = true;
  for (const [i, word] of words.entries()) {
    const span = document.createElement("span");
    span.className = lineStart ? "ocr-word ocr-line-start" : "ocr-word";
    span.dataset.ocrWord = "";
    if (lineStart) span.dataset.ocrLineStart = "";
    span.textContent = strings[i];
    spans.push(span);
    span.style.left = `${word.left}%`;
    span.style.top = `${word.top}%`;
    span.style.fontFamily = "sans-serif";
    span.style.setProperty("--font-height", `${word.height}px`);
    // The separator is searchable without extending the word's selection/annotation rectangle.
    span.style.width = `calc(var(--text-scale-factor) * ${word.width}px)`;
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
  const highlighter = view.textLayer?.highlighter;
  highlighter?.disable();
  highlighter?.setTextMapping(spans, strings);
  highlighter?.enable();
}


export function wordStrings(words: Word[]) {
  return words.map((word, i) => word.text + (i < words.length - 1 ? " " : ""));
}
