import { useEffect, useRef, useState } from "react";
import { Modal } from "./Dialogs";
import { SelectMenu } from "./SelectMenu";
import { loadPdf, renderThumbnail, type PDFDocumentProxy } from "./pdf";
import { MAX_PDF_BYTES, readPdfBlob } from "./pdfInput";
import type { PdfPageChange } from "./pdfPages";
import { changePdfPagesInWorker, inspectPdfPagesInWorker } from "./pdfPagesWorker";
import "./pdfPages.css";

function PageThumbnail({ pdf, number }: { pdf: PDFDocumentProxy; number: number }) {
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    }, { root: root.current!.closest(".pdf-pages-grid"), rootMargin: "150px" });
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    // Reentry gets a fresh canvas while PDF.js finishes cancelling the previous render.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    preview.current!.append(canvas); setError(false);
    const rendering = renderThumbnail(pdf, number, canvas, 100, 0, controller.signal);
    void rendering.catch(() => {
      canvas.width = canvas.height = 0;
      if (!controller.signal.aborted) { canvas.remove(); setError(true); }
    });
    return () => {
      controller.abort();
      for (const overlay of preview.current?.querySelectorAll<HTMLCanvasElement>(".folio-image-overlay") ?? []) overlay.width = overlay.height = 0;
      preview.current?.replaceChildren();
      // Free the completed bitmap immediately; in-flight renders release it on settlement.
      void rendering.finally(() => { canvas.width = canvas.height = 0; }).catch(() => {});
    };
  }, [pdf, number, visible]);
  return <div className="pdf-pages-thumbnail" ref={root}><span ref={preview} />{error && <span>Preview unavailable</span>}</div>;
}

export default function PdfPagesDialog({ bytes, name, onApply, onClose }: {
  bytes: Uint8Array; name: string; onApply: (bytes: Uint8Array, originalPages?: number[]) => Promise<void>; onClose: () => void;
}) {
  const [current, setCurrent] = useState(bytes);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [originalPages, setOriginalPages] = useState<number[]>([]);
  const [history, setHistory] = useState<{ bytes: Uint8Array; pages: number[] }[]>([]);
  const [position, setPosition] = useState("after");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const job = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; job.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let document: PDFDocumentProxy | undefined;
    let active = true;
    const timeout = setTimeout(() => controller.abort(new Error("The page preview timed out. Try again.")), 60_000);
    setLoading(true); setPdf(null); setError("");
    void (async () => {
      try {
        const count = await inspectPdfPagesInWorker(current, controller.signal);
        if (current === bytes && active) setOriginalPages(Array.from({ length: count }, (_, index) => index + 1));
        controller.signal.throwIfAborted();
        document = await loadPdf(current, controller.signal);
        if (controller.signal.aborted) { await document.loadingTask.destroy(); return; }
        setPdf(document);
      } catch (error) {
        if (active && mounted.current) setError(controller.signal.aborted ? String(controller.signal.reason.message) : (error as Error).message || "Couldn't load these pages.");
      } finally { clearTimeout(timeout); if (active && mounted.current) setLoading(false); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); if (document) void document.loadingTask.destroy(); };
  }, [current, retry]);
  const disabled = busy || applying || loading || !pdf;
  const index = selected.length ? position === "before" ? Math.min(...selected) : Math.max(...selected) + 1 : pdf?.numPages ?? 0;
  const close = () => { if (!applying && !locked.current) onClose(); };
  const change = async (operation: PdfPageChange | File) => {
    if (locked.current || disabled) return;
    locked.current = true; setBusy(true); setError("");
    const controller = new AbortController(); job.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error("The page change timed out. Try again.")), 60_000);
    try {
      const edit: PdfPageChange = operation instanceof File ? { type: "insert", index, bytes: await readPdfBlob(operation, controller.signal) } : operation;
      const next = await changePdfPagesInWorker(current, edit, controller.signal);
      const pages = [...originalPages];
      if (edit.type === "delete") { const removed = new Set(edit.pages); pages.splice(0, pages.length, ...pages.filter((_, index) => !removed.has(index))); }
      else if (edit.type === "blank") pages.splice(edit.index, 0, 0);
      else if (edit.type === "insert") pages.splice(edit.index, 0, ...Array((await inspectPdfPagesInWorker(next, controller.signal)) - originalPages.length).fill(0));
      if (controller.signal.aborted || !mounted.current) return;
      setHistory(previous => {
        const history = [...previous, { bytes: current, pages: originalPages }];
        let size = history.reduce((total, item) => total + item.bytes.byteLength, 0);
        while (history.length > 1 && (history.length > 10 || size > MAX_PDF_BYTES)) size -= history.shift()!.bytes.byteLength;
        return history;
      });
      setOriginalPages(pages); setCurrent(next); setSelected([]);
    } catch (error) {
      if (mounted.current) setError(controller.signal.aborted ? controller.signal.reason instanceof Error ? controller.signal.reason.message : "Page change stopped. Your edits are unchanged." : (error as Error).message || "Couldn't change these pages. Try again.");
    } finally { clearTimeout(timeout); job.current = null; locked.current = false; if (mounted.current) setBusy(false); }
  };
  const apply = async () => {
    if (locked.current || disabled || current === bytes) return;
    locked.current = true; setApplying(true); setError("");
    try { await onApply(current, originalPages); onClose(); }
    catch (error) { if (mounted.current) setError((error as Error).message || "Couldn't apply these pages. Your edits are still here; try again."); }
    finally { locked.current = false; if (mounted.current) setApplying(false); }
  };
  return <Modal title="Manage pages" onClose={close}>
    <div className="pdf-pages">
      <p className="pdf-pages-name">{name}</p>
      <p>Changes stay here until you apply them. Inserted pages keep their marks. Their bookmarks and accessibility tags stay in the source PDF.</p>
      <div className="pdf-pages-tools">
        <SelectMenu label="Insert position" value={position} disabled={disabled} onChange={setPosition} options={[{ value: "before", label: "Before selection" }, { value: "after", label: "After selection" }]} />
        <button type="button" className="btn ghost" disabled={disabled} onClick={() => file.current?.click()}>Insert PDF…</button>
        <input ref={file} type="file" accept="application/pdf,.pdf" aria-label="PDF to insert" hidden onChange={event => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) void change(picked); }} />
        <button type="button" className="btn ghost" disabled={disabled} onClick={() => void change({ type: "blank", index, matchPage: selected[0] ?? Math.max(0, (pdf?.numPages ?? 1) - 1) })}>Blank page</button>
        <button type="button" className="btn ghost" disabled={disabled || !selected.length} onClick={() => void change({ type: "rotate", pages: selected })}>Rotate 90°</button>
        <button type="button" className="btn ghost" disabled={disabled || !selected.length || selected.length === pdf?.numPages} onClick={() => void change({ type: "delete", pages: selected })}>Delete selected</button>
        <button type="button" className="btn ghost" disabled={disabled || !history.length} onClick={() => { setCurrent(history.at(-1)!.bytes); setOriginalPages(history.at(-1)!.pages); setHistory(history.slice(0, -1)); setSelected([]); }}>Undo</button>
      </div>
      <div className="pdf-pages-selection">
        <span role="status">{selected.length} selected{pdf ? ` · ${pdf.numPages} pages` : ""}</span>
        <button type="button" className="btn ghost" disabled={disabled} onClick={() => setSelected(selected.length === pdf?.numPages ? [] : Array.from({ length: pdf!.numPages }, (_, index) => index))}>{selected.length === pdf?.numPages ? "Clear selection" : "Select all"}</button>
      </div>
      {!selected.length && pdf && <p className="pdf-pages-hint">Select pages to choose an insertion position. With no selection, pages are added at the end.</p>}
      {loading && <p role="status">Loading pages…</p>}
      {pdf && <div className="pdf-pages-grid" aria-label="PDF pages">
        {Array.from({ length: pdf.numPages }, (_, index) => <label className="pdf-pages-page" key={index} data-selected={selected.includes(index) || undefined}>
          <PageThumbnail pdf={pdf} number={index + 1} />
          <span><input type="checkbox" disabled={disabled} checked={selected.includes(index)} aria-label={`Select page ${index + 1}`} onChange={event => setSelected(previous => event.target.checked ? [...previous, index].sort((a, b) => a - b) : previous.filter(page => page !== index))} />Page {index + 1}</span>
        </label>)}
      </div>}
      {(busy || applying) && <p role="status">{applying ? "Applying pages…" : "Updating pages…"}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!pdf && error && <button type="button" className="btn ghost" onClick={() => { setLoading(true); setRetry(retry + 1); }}>Retry</button>}
      <div className="form-actions">
        <button type="button" className="btn ghost" disabled={applying} onClick={busy ? () => job.current?.abort(new Error("Page change stopped. Your edits are unchanged.")) : close}>{busy ? "Stop" : "Cancel"}</button>
        <button type="button" className="btn primary" disabled={disabled || current === bytes} onClick={() => void apply()}>Apply changes</button>
      </div>
    </div>
  </Modal>;
}
