import { changePdfPages, inspectPdfPages, type PdfPageChange } from "./pdfPages";

self.onmessage = async ({ data }: MessageEvent<{ bytes: Uint8Array; change?: PdfPageChange }>) => {
  try {
    if (!data.change) { self.postMessage({ count: await inspectPdfPages(data.bytes) }); return; }
    const bytes = await changePdfPages(data.bytes, data.change);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) { self.postMessage({ error: (error as Error).message || "Couldn't process these pages. Try again." }); }
};
