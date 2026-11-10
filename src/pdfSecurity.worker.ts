import { init } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { checkPageCount, checkPdfSize } from "./pdfInput";

self.onmessage = async ({ data }: MessageEvent<{ bytes: Uint8Array; password?: string }>) => {
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error("Couldn't load PDF protection. Try again.");
    const m = await init({ wasmBinary: await response.arrayBuffer() });
    m.PDFiumExt_Init();
    const ptr = m.pdfium.wasmExports.malloc(data.bytes.length);
    if (!ptr) throw new Error("Not enough memory to prepare this PDF.");
    let doc = 0, writer = 0, output = 0;
    try {
      m.pdfium.HEAPU8.set(data.bytes, ptr);
      doc = m.FPDF_LoadMemDocument(ptr, data.bytes.length, "");
      if (!doc) throw new Error("Use an unsigned, unencrypted PDF for this operation.");
      if (m.EPDF_IsEncrypted(doc) || m.FPDF_GetSignatureCount(doc) > 0) throw new Error("Use an unsigned, unencrypted PDF for this operation.");
      checkPageCount(m.FPDF_GetPageCount(doc));
      if (data.password === undefined) { self.postMessage({ ok: true }); return; }
      // PDFium's extension uses AES-256. All usage permissions remain enabled.
      if (!m.EPDF_SetEncryption(doc, data.password, data.password, -4)) throw new Error("Couldn't encrypt this PDF.");
      writer = m.PDFiumExt_OpenFileWriter();
      if (!writer || !m.FPDF_SaveAsCopy(doc, writer, 2)) throw new Error("Couldn't write the protected copy.");
      const size = m.PDFiumExt_GetFileWriterSize(writer);
      checkPdfSize(size);
      output = m.pdfium.wasmExports.malloc(size);
      if (!output || !size || m.PDFiumExt_GetFileWriterData(writer, output, size) !== size) throw new Error("Couldn't read the protected copy.");
      const bytes = (m.pdfium.HEAPU8 as Uint8Array).slice(output, output + size);
      self.postMessage({ bytes }, { transfer: [bytes.buffer] });
    } finally {
      if (output) m.pdfium.wasmExports.free(output);
      if (writer) m.PDFiumExt_CloseFileWriter(writer);
      if (doc) m.FPDF_CloseDocument(doc);
      m.pdfium.wasmExports.free(ptr);
    }
  } catch (error) { self.postMessage({ error: (error as Error).message || "Couldn't prepare this PDF. Try again." }); }
};
