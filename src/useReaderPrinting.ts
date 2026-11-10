import { useEffect, useRef, useState } from "react";
import { loadPdf, type PDFDocumentProxy } from "./pdf";

interface PrintInput {
  bytes: Uint8Array;
  name: string;
  page: number;
  password?: string;
  signal: AbortSignal;
  isCurrent(): boolean;
}
interface PrintSnapshot {
  pdf: PDFDocumentProxy;
  bytes: Uint8Array;
  page: number;
  name: string;
}

export function useReaderPrinting({ prepare, saveCopy, flash, onError, onPrepareError }: {
  prepare(): Promise<PrintInput | undefined>;
  saveCopy(bytes: Uint8Array): Promise<boolean>;
  flash(message: string): void;
  onError(message: string): void;
  onPrepareError(): void;
}) {
  const [printCopy, setPrintCopy] = useState<PrintSnapshot | null>(null);
  const preparingPrint = useRef(false);
  useEffect(() => () => { if (printCopy) void printCopy.pdf.loadingTask.destroy(); }, [printCopy]);

  const printPdfBytes = (bytes: Uint8Array) => {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.src = url;
    frame.onload = () => {
      setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          // The desktop shell denies blob: pop-ups, so a saved copy is the working fallback there.
          if (window.folioDesktop) { void saveCopy(bytes).then(saved => { if (saved) flash("Couldn't print — saved a copy instead"); }).catch(error => onError(error.message || "Couldn’t save a copy.")); }
          else window.open(url, "_blank");
        }
      }, 250);
    };
    document.body.appendChild(frame);
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  const print = async () => {
    if (printCopy || preparingPrint.current) return;
    preparingPrint.current = true;
    try {
      const input = await prepare();
      if (!input) return;
      if (!window.folioDesktop) { printPdfBytes(input.bytes); return; }
      const snapshot = await loadPdf(input.bytes, input.signal, input.password);
      if (!input.isCurrent()) { void snapshot.loadingTask.destroy(); return; }
      setPrintCopy({ pdf: snapshot, bytes: input.bytes, page: input.page, name: input.name });
    } catch {
      onPrepareError();
    } finally {
      preparingPrint.current = false;
    }
  };

  return { printCopy, setPrintCopy, print, printPdfBytes };
}
