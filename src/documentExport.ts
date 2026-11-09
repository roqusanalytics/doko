import { PDFDocument } from "pdf-lib/es";
import { loadPdf } from "./pdf";
import { checkPdfSize } from "./pdfInput";

export type ExportFormat = "pdf" | "png" | "jpeg" | "webp";
export interface ExportSnapshot { bytes: Uint8Array; name: string; photo: boolean; page: number; password?: string }
export interface ExportOptions { format: ExportFormat; compress: boolean; quality: number; maxEdge: number }
export interface ExportResult { blob: Blob; name: string; originalSize: number; baseline: string; smaller: boolean }

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
      if (!(width > 0 && height > 0) || !Number.isFinite(width * height) || width * height > 80_000_000 || (!(snapshot.photo && options.format === "png") && Math.max(width, height) > 32767)) throw new Error("Image exceeds the 80 million pixel export limit. Choose a smaller size.");
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
  const stem = snapshot.name.replace(/\.[^.]+$/, "") || "document";
  const page = !snapshot.photo && options.format !== "pdf" ? snapshot.page : undefined;
  const name = `${stem}${options.compress ? "-compressed" : page ? `-page-${page}` : "-export"}.${options.format === "jpeg" ? "jpg" : options.format}`;
  return { blob, name, originalSize, baseline, smaller: blob.size < originalSize };
}

export async function photoPdf(blob: Blob, signal?: AbortSignal): Promise<Uint8Array> {
  if (blob.size > 100 * 1024 * 1024) throw new Error("Image exceeds 100 MB.");
  signal?.throwIfAborted();
  // A bitmap freezes animated images at their first frame and applies the source orientation.
  const image = await createImageBitmap(blob);
  let canvas: HTMLCanvasElement | undefined;
  try {
    signal?.throwIfAborted();
    if (!(image.width > 0 && image.height > 0) || !Number.isFinite(image.width * image.height)) throw new Error("Couldn't read this image's dimensions.");
    if (image.width * image.height > 80_000_000) throw new Error("Image exceeds 80 million pixels.");
    canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn't allocate this image. Try a smaller image.");
    context.drawImage(image, 0, 0);
    const png = await encode(canvas, "png", 1);
    signal?.throwIfAborted();
    const pdf = await PDFDocument.create();
    const embedded = await pdf.embedPng(await png.arrayBuffer());
    signal?.throwIfAborted();
    // One PDF point per source pixel makes PNG export retain the original dimensions.
    pdf.addPage([image.width, image.height]).drawImage(embedded, { x: 0, y: 0, width: image.width, height: image.height });
    const bytes = await pdf.save();
    signal?.throwIfAborted();
    return bytes;
  } finally {
    image.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
