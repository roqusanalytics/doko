import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Modal } from "./Dialogs";
import type { PdfSecurityDialogProps, RedactionArea } from "./pdfSecurity";
import type { PDFDocumentProxy } from "./pdf";
import "./pdfSecurity.css";

export default function PdfRedactDialog({ bytes, name, onApply, onClose }: PdfSecurityDialogProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [pageNumber, setPage] = useState(1);
  const [areas, setAreas] = useState<RedactionArea[]>([]), [draft, setDraft] = useState<RedactionArea | null>(null);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [reload, setReload] = useState(0), [confirmed, setConfirmed] = useState(false);
  const [coordinates, setCoordinates] = useState([10, 10, 30, 10]);
  const prepared = useRef<{ areas: RedactionArea[]; bytes: Uint8Array } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), root = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null), job = useRef<AbortController | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.closest(".modal")?.querySelector<HTMLElement>("button")?.focus();
    return () => { job.current?.abort(); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Preview timed out. Retry with a smaller PDF.")), 60_000);
    let loaded: PDFDocumentProxy | null = null;
    setPdf(null); setError("");
    void import("./pdfSecurity").then(({ loadRedactionPdf }) => loadRedactionPdf(bytes, controller.signal)).then(doc => { loaded = doc; if (!controller.signal.aborted) setPdf(doc); else void doc.loadingTask.destroy(); }).catch(error => { if (!controller.signal.aborted || controller.signal.reason instanceof Error) setError(controller.signal.aborted ? controller.signal.reason.message : error.message || "Couldn't open this PDF. Retry."); }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); void loaded?.loadingTask.destroy(); };
  }, [bytes, reload]);
  useEffect(() => {
    if (!pdf) return;
    const controller = new AbortController();
    setReady(false); setDraft(null); start.current = null; setError("");
    const timer = setTimeout(() => controller.abort(new Error("Page preview timed out. Try another page or retry.")), 60_000);
    void (async () => {
      const page = await pdf.getPage(pageNumber); controller.signal.throwIfAborted();
      const original = page.getViewport({ scale: 1 });
      const view = page.getViewport({ scale: Math.min(2, 900 / original.width) });
      if (view.width * view.height > 20_000_000 || view.height > 16384) throw new Error("This page is too large to preview safely.");
      const target = canvas.current!; target.width = Math.ceil(view.width); target.height = Math.ceil(view.height);
      const task = page.render({ canvas: target, viewport: view, background: "white", intent: "display" });
      const abort = () => task.cancel(); controller.signal.addEventListener("abort", abort, { once: true });
      try { await task.promise; controller.signal.throwIfAborted(); setReady(true); }
      finally { controller.signal.removeEventListener("abort", abort); }
    })().catch(error => { if (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError") setError(controller.signal.aborted ? controller.signal.reason.message : error.message || "Couldn't render this page."); }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pdf, pageNumber, reload]);
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const region = (from: { x: number; y: number }, to: { x: number; y: number }): RedactionArea => ({ page: pageNumber, x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y) });
  const add = () => {
    const [x, y, width, height] = coordinates;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) { setError("Enter an area inside the page (0–100%)."); return; }
    setAreas(current => [...current, { page: pageNumber, x: x / 100, y: y / 100, width: width / 100, height: height / 100 }]); setError("");
  };
  const apply = async () => {
    if (busy || !confirmed || !areas.length) return;
    const controller = new AbortController(); job.current = controller;
    const timer = setTimeout(() => controller.abort(new Error("Redaction timed out. Split the PDF into smaller files and retry.")), 120_000);
    setBusy(true); setError("");
    try {
      const { redactPdf } = await import("./pdfSecurity");
      const result = prepared.current?.areas === areas ? prepared.current.bytes : await redactPdf(bytes, areas, controller.signal, (page, total) => setStatus(`Flattening page ${page} of ${total}…`));
      prepared.current = { areas, bytes: result };
      controller.signal.throwIfAborted(); clearTimeout(timer); setSaving(true);
      await onApply(result); onClose();
    } catch (error) { setError(controller.signal.aborted ? controller.signal.reason?.message || "Redaction cancelled." : (error as Error).message || "Couldn't save the redacted copy. Try again."); }
    finally { clearTimeout(timer); job.current = null; setBusy(false); setSaving(false); }
  };
  return <Modal title="Redact a copy" onClose={saving ? () => {} : onClose}>
    <div className="pdf-security pdf-redact" ref={root}>
      <p className="pdf-security-name">{name}</p>
      <p>Drag over private content, or enter an area below. Black areas permanently replace the selected pixels in a new copy. The original stays unchanged.</p>
      <p className="pdf-security-notice"><strong>Every page becomes a flat image at 144 DPI.</strong> Searchable text, editable forms, links, metadata and attachments are removed from the copy. Processing stays on this device. Use an unsigned, unencrypted PDF.</p>
      {!pdf && !error && <p role="status">Opening preview…</p>}
      {pdf && <>
        <div className="pdf-redact-pages"><button className="btn ghost" disabled={busy || pageNumber === 1} onClick={() => setPage(pageNumber - 1)}>Previous</button><span>Page {pageNumber} of {pdf.numPages}</span><button className="btn ghost" disabled={busy || pageNumber === pdf.numPages} onClick={() => setPage(pageNumber + 1)}>Next</button></div>
        <div className="pdf-redact-scroll"><div className="pdf-redact-stage" aria-label="Redaction page preview" onPointerDown={event => {
          if (!ready || busy || event.button !== 0) return;
          start.current = position(event); event.currentTarget.setPointerCapture(event.pointerId); setDraft(null);
        }} onPointerMove={event => { if (start.current) setDraft(region(start.current, position(event))); }} onPointerCancel={() => { start.current = null; setDraft(null); }} onPointerUp={event => {
          if (!start.current) return;
          const area = region(start.current, position(event)); start.current = null; setDraft(null);
          if (area.width > 0.002 && area.height > 0.002) setAreas(current => [...current, area]);
        }}>
          <canvas ref={canvas} style={{ visibility: ready ? "visible" : "hidden" }} />
          {ready && [...areas.filter(a => a.page === pageNumber), ...(draft ? [draft] : [])].map((a, index) => <div key={index} className="pdf-redact-area" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.width * 100}%`, height: `${a.height * 100}%` }} />)}
        </div></div>
        {!ready && !error && <p role="status">Rendering page…</p>}
        <fieldset className="pdf-redact-coordinates" disabled={!ready || busy}>
          {["Left %", "Top %", "Width %", "Height %"].map((label, index) => <label key={label}>{label}<input type="number" min="0" max="100" step="1" value={coordinates[index]} onChange={event => setCoordinates(current => current.map((value, i) => i === index ? Number(event.target.value) : value))} /></label>)}
          <button className="btn ghost" type="button" onClick={add}>Add area</button>
        </fieldset>
        <div className="pdf-redact-selected"><span>{areas.length} marked {areas.length === 1 ? "area" : "areas"}</span><button className="btn ghost" disabled={busy || !areas.length} onClick={() => setAreas([])}>Clear all</button></div>
        {areas.length > 0 && <ul className="pdf-redact-list">{areas.map((a, index) => <li key={index}><span>Area {index + 1} · Page {a.page}</span><button className="btn ghost" aria-label={`Remove area ${index + 1}`} disabled={busy} onClick={() => setAreas(current => current.filter((_, i) => i !== index))}>Remove</button></li>)}</ul>}
        <label className="pdf-security-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I understand that every page will be flattened and the copy cannot be unredacted.</label>
      </>}
      {busy && <p role="status">{saving ? "Saving redacted copy…" : status}</p>}
      {error && <p className="form-error" role="alert">{error} {!busy && <button className="btn ghost" onClick={() => setReload(reload + 1)}>Retry preview</button>}</p>}
      <div className="form-actions"><button className="btn ghost" disabled={saving} onClick={busy ? () => job.current?.abort(new Error("Redaction cancelled.")) : onClose}>{busy ? "Stop" : "Cancel"}</button><button className="btn primary" disabled={busy || !pdf || !areas.length || !confirmed} onClick={() => void apply()}>Apply to a copy…</button></div>
    </div>
  </Modal>;
}
