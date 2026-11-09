import { PDFDocument } from "pdf-lib/es";
import { loadPdf } from "./pdf";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 80_000_000;

function checkDimensions(width: number, height: number) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width * height)) throw new Error("Couldn't read this image's dimensions.");
  if (width * height > MAX_PIXELS) throw new Error("Image exceeds 80 million pixels.");
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't encode this image. Try a smaller image.")), "image/png"));
}

export async function photoPdf(blob: Blob, signal?: AbortSignal): Promise<Uint8Array> {
  if (blob.size > MAX_BYTES) throw new Error("Image exceeds 100 MB.");
  signal?.throwIfAborted();
  // A bitmap freezes animated images at their first frame and applies the source orientation.
  const image = await createImageBitmap(blob);
  let canvas: HTMLCanvasElement | undefined;
  try {
    signal?.throwIfAborted();
    checkDimensions(image.width, image.height);
    canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn't allocate this image. Try a smaller image.");
    context.drawImage(image, 0, 0);
    const png = await pngBlob(canvas);
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

export async function photoPng(bytes: Uint8Array, signal: AbortSignal): Promise<Blob> {
  const pdf = await loadPdf(bytes, signal);
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (pdf.numPages !== 1) throw new Error("Save as PNG is available for a single photo.");
    const page = await pdf.getPage(1);
    signal.throwIfAborted();
    const viewport = page.getViewport({ scale: 1 });
    checkDimensions(viewport.width, viewport.height);
    canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    // The renderer otherwise requests an opaque context, which flattens PNG transparency.
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Couldn't allocate this image. Try a smaller image.");
    const task = page.render({ canvas: null, canvasContext: context, viewport, intent: "print", background: "rgba(0, 0, 0, 0)" });
    const cancel = () => task.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try { await task.promise; signal.throwIfAborted(); }
    finally { signal.removeEventListener("abort", cancel); }
    const png = await pngBlob(canvas);
    signal.throwIfAborted();
    return png;
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    await pdf.loadingTask.destroy();
  }
}
