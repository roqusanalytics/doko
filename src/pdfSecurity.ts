import { PDFDocument } from "pdf-lib/es";
import { loadPdf } from "./pdf";
import { checkPdfSize } from "./pdfInput";

/** Normalized coordinates in the displayed crop box, including the PDF page's rotation. */
export interface RedactionArea { page: number; x: number; y: number; width: number; height: number }
export interface PdfSecurityDialogProps {
  bytes: Uint8Array; name: string;
  onApply: (bytes: Uint8Array, password?: string) => Promise<void>;
  onClose: () => void;
}

function input(bytes: Uint8Array) {
  checkPdfSize(bytes.byteLength);
  if (!bytes.length) throw new Error("This PDF is empty.");
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new Error("Choose a valid PDF.");
}
export function validatePdfPassword(password: string, confirmation = password) {
  if (!password.trim()) throw new Error("Enter a password.");
  if (password.includes("\0") || new TextEncoder().encode(password).length > 127) throw new Error("Use a password of up to 127 UTF-8 bytes, without null characters.");
  if (password !== confirmation) throw new Error("The passwords don't match.");
}
function securityWorker(bytes: Uint8Array, signal: AbortSignal, password?: string): Promise<Uint8Array | undefined> {
  input(bytes); signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdfSecurity.worker.ts", import.meta.url), { type: "module" });
    const finish = (error?: unknown, output?: Uint8Array) => {
      clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate();
      if (error) reject(error); else resolve(output);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error("PDF processing timed out. Try a smaller PDF.")), 60_000);
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : undefined, data.bytes);
    worker.onerror = () => finish(new Error("PDF processing failed. Try again."));
    worker.onmessageerror = () => finish(new Error("Couldn't read the PDF worker response. Try again."));
    signal.addEventListener("abort", abort, { once: true });
    try { worker.postMessage({ bytes, password }); } catch (error) { finish(error); }
  });
}
export async function protectPdf(bytes: Uint8Array, password: string, signal: AbortSignal) {
  validatePdfPassword(password);
  return (await securityWorker(bytes, signal, password))!;
}
export async function loadRedactionPdf(bytes: Uint8Array, signal: AbortSignal) {
  await securityWorker(bytes, signal);
  return loadPdf(bytes, signal);
}

/** Rebuild exclusively from sanitized pixels: no source objects, hidden text, attachments or old revisions. */
export async function redactPdf(bytes: Uint8Array, areas: RedactionArea[], signal: AbortSignal, progress?: (page: number, total: number) => void) {
  if (!areas.length) throw new Error("Mark at least one area to redact.");
  for (const a of areas) {
    if (!Number.isSafeInteger(a.page) || a.page < 1 || ![a.x, a.y, a.width, a.height].every(Number.isFinite) || a.x < 0 || a.y < 0 || a.width <= 0 || a.height <= 0 || a.x + a.width > 1.000001 || a.y + a.height > 1.000001) throw new Error("Choose a valid redaction area inside the page.");
  }
  const pdf = await loadRedactionPdf(bytes, signal);
  const stop = () => { void pdf.loadingTask.destroy().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (areas.some(area => area.page > pdf.numPages)) throw new Error("Choose an existing page.");
    const output = await PDFDocument.create({ updateMetadata: false });
    let totalPixels = 0, imageBytes = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted(); progress?.(number, pdf.numPages);
      const page = await pdf.getPage(number), view = page.getViewport({ scale: 2 });
      const width = Math.ceil(view.width), height = Math.ceil(view.height);
      totalPixels += width * height;
      if (!Number.isFinite(totalPixels) || width * height > 20_000_000 || width > 16384 || height > 16384 || totalPixels > 100_000_000) throw new Error("This PDF is too large to redact safely (20 million pixels per page, 100 million total at 144 DPI). Split it into smaller PDFs first.");
      const canvas = Object.assign(document.createElement("canvas"), { width, height });
      try {
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Couldn't render this page. Try a smaller PDF.");
        const task = page.render({ canvas: null, canvasContext: context, viewport: view, background: "white", intent: "display" });
        const cancel = () => task.cancel();
        signal.addEventListener("abort", cancel, { once: true });
        try { await task.promise; } finally { signal.removeEventListener("abort", cancel); }
        signal.throwIfAborted();
        context.fillStyle = "black";
        for (const a of areas.filter(area => area.page === number)) {
          // Expand to whole pixels so antialiasing cannot expose a sliver along the selected edge.
          const left = Math.max(0, Math.floor(a.x * view.width) - 1), top = Math.max(0, Math.floor(a.y * view.height) - 1);
          context.fillRect(left, top, Math.ceil((a.x + a.width) * view.width) + 1 - left, Math.ceil((a.y + a.height) * view.height) + 1 - top);
        }
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't encode the redacted page.")), "image/png"));
        imageBytes += png.size; checkPdfSize(imageBytes);
        signal.throwIfAborted();
        const image = await output.embedPng(await png.arrayBuffer());
        await image.embed();
        output.addPage([view.width / 2, view.height / 2]).drawImage(image, { x: 0, y: 0, width: view.width / 2, height: view.height / 2 });
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    }
    signal.throwIfAborted();
    const saved = await output.save(); checkPdfSize(saved.length); signal.throwIfAborted();
    return saved;
  } finally { signal.removeEventListener("abort", stop); await pdf.loadingTask.destroy(); }
}
