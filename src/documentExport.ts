import { PDFDocument } from "pdf-lib/es";
import { loadPdf } from "./pdf";
import { checkPdfSize } from "./pdfInput";

export type ExportFormat = "pdf" | "png" | "jpeg" | "webp";
export interface ExportSnapshot { bytes: Uint8Array; name: string; photo: boolean; page: number; password?: string }
export interface ExportOptions { format: ExportFormat; compress: boolean; quality: number; maxEdge: number }
export interface ExportResult { blob: Blob; name: string; originalSize: number; baseline: string; smaller: boolean }

function outputName(name: string, format: ExportFormat, compress: boolean, page?: number) {
  const stem = name.replace(/\.[^.]+$/, "") || "document";
  return `${stem}${compress ? "-compressed" : page ? `-page-${page}` : "-export"}.${format === "jpeg" ? "jpg" : format}`;
}
function encode(canvas: HTMLCanvasElement, format: ExportFormat, quality: number): Promise<Blob> {
  const mime = `image/${format}`;
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== mime) reject(new Error("This image format could not be encoded. Try PNG or a smaller image."));
    else resolve(blob);
  }, mime, quality));
}

/** Creates a separate output; neither pdf.js nor pdf-lib receives the caller's transferable buffer. */
export async function prepareDocumentExport(snapshot: ExportSnapshot, options: ExportOptions, signal: AbortSignal): Promise<ExportResult> {
  signal.throwIfAborted();
  checkPdfSize(snapshot.bytes.byteLength);
  if (!snapshot.bytes.length) throw new Error("This document is empty.");
  if (!["pdf", "png", "jpeg", "webp"].includes(options.format)) throw new Error("Choose a supported export format.");
  if (!(options.quality >= 0.1 && options.quality <= 1) || ![0, 1280, 2048, 4096].includes(options.maxEdge)) throw new Error("Choose valid image quality and size.");
  let blob: Blob;
  let originalSize = snapshot.bytes.byteLength;
  let baseline = "PDF snapshot";
  if (options.format === "pdf") {
    if (!options.compress) {
      const pdf = await loadPdf(snapshot.bytes, signal, snapshot.password);
      await pdf.loadingTask.destroy();
      blob = new Blob([snapshot.bytes.slice()], { type: "application/pdf" });
    } else {
      // Rewriting encrypted PDFs would remove their protection; keep their original bytes instead.
      let doc;
      try { doc = await PDFDocument.load(snapshot.bytes.slice(), { updateMetadata: false }); }
      catch (error) {
        if ((error as Error).message?.includes("encrypted")) throw new Error("Password-protected PDFs cannot be compressed while keeping their protection. Use Export / Convert to save a PDF copy or an image instead.");
        throw error;
      }
      signal.throwIfAborted();
      if (!doc.getPageCount()) throw new Error("This PDF has no pages.");
      const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
      signal.throwIfAborted();
      blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
    }
  } else {
    const pdf = await loadPdf(snapshot.bytes, signal, snapshot.password);
    const stop = () => { void pdf.loadingTask.destroy().catch(() => {}); };
    signal.addEventListener("abort", stop, { once: true });
    let canvas: HTMLCanvasElement | undefined;
    try {
      signal.throwIfAborted();
      if (snapshot.photo && pdf.numPages !== 1) throw new Error("Photo export requires a single photo.");
      if (!Number.isSafeInteger(snapshot.page) || snapshot.page < 1 || snapshot.page > pdf.numPages) throw new Error("Choose an existing page.");
      const page = await pdf.getPage(snapshot.photo ? 1 : snapshot.page);
      signal.throwIfAborted();
      const base = page.getViewport({ scale: snapshot.photo ? 1 : 2 });
      const scale = options.maxEdge ? Math.min(1, options.maxEdge / Math.max(base.width, base.height)) : 1;
      const viewport = page.getViewport({ scale: (snapshot.photo ? 1 : 2) * scale });
      const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
      if (!(width > 0 && height > 0) || !Number.isFinite(width * height) || width * height > 80_000_000 || Math.max(width, height) > 32767) throw new Error("Image exceeds the 80 million pixel export limit. Choose a smaller size.");
      canvas = Object.assign(document.createElement("canvas"), { width, height });
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Couldn't allocate this image. Choose a smaller size.");
      const task = page.render({ canvas: null, canvasContext: context, viewport, intent: "print", background: "rgba(0, 0, 0, 0)" });
      const cancel = () => task.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      try { await task.promise; signal.throwIfAborted(); }
      finally { signal.removeEventListener("abort", cancel); }
      if (snapshot.photo && options.compress) {
        originalSize = (await encode(canvas, "png", 1)).size;
        baseline = options.maxEdge ? "Resized edited PNG" : "Edited PNG";
        signal.throwIfAborted();
      }
      if (options.format === "jpeg") {
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "white"; context.fillRect(0, 0, width, height);
      }
      blob = await encode(canvas, options.format, options.quality);
      signal.throwIfAborted();
    } finally {
      if (canvas) canvas.width = canvas.height = 0;
      signal.removeEventListener("abort", stop);
      await pdf.loadingTask.destroy();
    }
  }
  return { blob, name: outputName(snapshot.name, options.format, options.compress, snapshot.photo || options.format === "pdf" ? undefined : snapshot.page), originalSize, baseline, smaller: blob.size < originalSize };
}
