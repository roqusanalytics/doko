import { useEffect, useRef, useState } from "react";
import { Modal, formatBytes } from "./Dialogs";
import { SelectMenu } from "./SelectMenu";
import { MAX_CANVAS_EXPORT_PADDING, prepareCanvasExport, type CanvasExportFormat, type CanvasExportSnapshot } from "./canvasDocument/canvasDocumentExport";
import type { ExportFormat, ExportResult, ExportSnapshot } from "./documentExport";
import "./documentExport.css";

export default function DocumentExportDialog({ snapshot, mode, onClose, onSave }: {
  snapshot: ExportSnapshot | CanvasExportSnapshot; mode: "export" | "compress"; onClose: () => void;
  onSave: (blob: Blob, name: string) => Promise<boolean>;
}) {
  const compress = mode === "compress";
  const isCanvasDocument = "elements" in snapshot;
  const photo = !isCanvasDocument && snapshot.photo;
  const [format, setFormat] = useState<ExportFormat | CanvasExportFormat>(isCanvasDocument ? "png" : compress && photo ? "jpeg" : "pdf");
  const [quality, setQuality] = useState(0.8);
  const [maxEdge, setMaxEdge] = useState(compress && photo ? 2048 : 0);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [background, setBackground] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [padding, setPadding] = useState("10");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportResult | Pick<ExportResult, "blob" | "name"> | null>(null);
  const job = useRef<AbortController | null>(null);
  const root = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const dialog = root.current!.closest<HTMLElement>(".modal")!;
    dialog.querySelector<HTMLElement>("select,button")?.focus();

    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled)")].filter(el => el.checkVisibility());
      const first = controls[0], last = controls.at(-1);

      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }

      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };

    dialog.addEventListener("keydown", trap);

    return () => { job.current?.abort(); dialog.removeEventListener("keydown", trap); focus?.focus(); };
  }, []);
  const reset = () => { setResult(null); setError(""); };

  const prepare = async () => {
    if (busy || saving) return;
    const controller = new AbortController(); job.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error("Export timed out. Try a smaller image or retry.")), 60_000);
    setBusy(true); setError(""); setResult(null);

    try {
      const output = isCanvasDocument
        ? await prepareCanvasExport(snapshot, { format: format as CanvasExportFormat, selectedOnly, background, darkMode, padding: Number(padding) }, controller.signal)
        : await (await import("./documentExport")).prepareDocumentExport(snapshot, { format: format as ExportFormat, compress, quality, maxEdge }, controller.signal);

      if (!controller.signal.aborted) setResult(output);
    } catch (error) {
      if (job.current === controller) setError(controller.signal.aborted ? controller.signal.reason instanceof Error ? controller.signal.reason.message : "Export cancelled." : (error as Error).message || "Couldn't prepare this export. Try again.");
    } finally {
      clearTimeout(timeout);

      if (job.current === controller) { job.current = null; setBusy(false); }
    }
  };

  const save = async () => {
    if (!result || saving) return;
    setSaving(true); setError("");

    try { if (await onSave(result.blob, result.name)) onClose(); }
    catch (error) { setError((error as Error).message || "Couldn't save this copy. Try again."); }
    finally { setSaving(false); }
  };

  return <Modal title={compress ? "Compress a copy" : "Export a copy"} onClose={saving ? () => {} : onClose}>
    <form className="document-export" ref={root} onSubmit={event => { event.preventDefault(); void (result ? save() : prepare()); }}>
      <p className="document-export-name">{snapshot.name}</p>
      {!isCanvasDocument && <p>Your original stays unchanged. {photo ? "Exports include the current photo edits." : "Image formats export the current page only, including saved marks."}</p>}
      <fieldset disabled={busy || saving}>
        <label>Format<SelectMenu label="Export format" value={format} onChange={value => { setFormat(value as ExportFormat | CanvasExportFormat); reset(); }} options={isCanvasDocument ? [
          { value: "png", label: "PNG" }, { value: "svg", label: "SVG" }, { value: "pdf", label: "PDF" },
        ] : [
          ...(!compress || !photo ? [{ value: "pdf", label: compress ? "PDF · lossless optimization" : "PDF" }] : []),
          ...(!compress || photo ? [{ value: "png", label: "PNG · transparent" }, { value: "jpeg", label: "JPEG · smaller image" }, { value: "webp", label: "WebP · smaller image" }] : []),
        ]} /></label>
        {isCanvasDocument ? <>
          <label className="document-export-checkbox"><input type="checkbox" checked={selectedOnly} disabled={!snapshot.selection.length} onChange={event => { setSelectedOnly(event.target.checked); reset(); }} />Selected Elements only</label>
          <label className="document-export-checkbox"><input type="checkbox" checked={background} onChange={event => { setBackground(event.target.checked); reset(); }} />Include background</label>
          <label className="document-export-checkbox"><input type="checkbox" checked={darkMode} onChange={event => { setDarkMode(event.target.checked); reset(); }} />Dark mode</label>
          <label>Padding (px)<input type="number" required min="0" max={MAX_CANVAS_EXPORT_PADDING} step="1" value={padding} onChange={event => { setPadding(event.target.value); reset(); }} /></label>
        </> : format !== "pdf" && <>
          <label>Image size<SelectMenu label="Export image size" value={String(maxEdge)} onChange={value => { setMaxEdge(Number(value)); reset(); }} options={[
            { value: "0", label: photo ? "Original dimensions" : "144 DPI" },
            ...[4096, 2048, 1280].map(size => ({ value: String(size), label: `Up to ${size} px` })),
          ]} /></label>
          {format !== "png" && <label>Quality · {Math.round(quality * 100)}%<input aria-label="Export quality" type="range" min="10" max="100" value={Math.round(quality * 100)} onChange={event => { setQuality(Number(event.target.value) / 100); reset(); }} /></label>}
        </>}
      </fieldset>
      {format === "jpeg" && <p className="document-export-notice">JPEG loses some image detail and replaces transparent areas with white.</p>}
      {format === "webp" && <p className="document-export-notice">WebP uses lossy compression and keeps transparent areas.</p>}
      {format === "pdf" && compress && <p>Text, forms, and annotations stay editable. Existing images keep their quality. Optimized PDFs may not get smaller. Rewriting a PDF invalidates digital signatures.</p>}
      {result && <div className="document-export-result" role="status">
        <strong>{formatBytes(result.blob.size)}</strong>
        {"baseline" in result && <>
          <span>{result.baseline}: {formatBytes(result.originalSize)}</span>
          {compress && <span>{result.smaller ? `${Math.round((1 - result.blob.size / result.originalSize) * 100)}% smaller` : "No size reduction. You can keep the original or save this copy."}</span>}
        </>}
      </div>}
      {busy && <p role="status">Preparing your copy…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="btn ghost" type="button" disabled={saving} onClick={busy ? () => job.current?.abort(new Error("Export cancelled.")) : onClose}>{busy ? "Stop" : "Cancel"}</button>
        <button className="btn primary" type="submit" disabled={busy || saving}>{saving ? "Saving…" : result ? "Save copy…" : compress ? "Compress" : "Prepare export"}</button>
      </div>
    </form>
  </Modal>;
}
