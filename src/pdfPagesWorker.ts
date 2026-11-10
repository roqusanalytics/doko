import type { PdfPageChange } from "./pdfPages";

function pagesWorker(bytes: Uint8Array, signal: AbortSignal, change?: PdfPageChange): Promise<{ count?: number; bytes?: Uint8Array }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdfPages.worker.ts", import.meta.url), { type: "module" });
    const finish = (error?: unknown, output?: { count?: number; bytes?: Uint8Array }) => {
      clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate();
      if (error) reject(error); else resolve(output!);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error("PDF page processing timed out. Try a smaller PDF.")), 60_000);
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : undefined, data);
    worker.onerror = () => finish(new Error("PDF page processing failed. Try again."));
    worker.onmessageerror = () => finish(new Error("Couldn't read the processed PDF. Try again."));
    signal.addEventListener("abort", abort, { once: true });
    // Clone inputs: the renderer still needs these bytes for preview, Apply and Undo.
    try { worker.postMessage({ bytes, change }); } catch (error) { finish(error); }
  });
}

export async function inspectPdfPagesInWorker(bytes: Uint8Array, signal: AbortSignal) {
  return (await pagesWorker(bytes, signal)).count!;
}
export async function changePdfPagesInWorker(bytes: Uint8Array, change: PdfPageChange, signal: AbortSignal) {
  return (await pagesWorker(bytes, signal, change)).bytes!;
}
