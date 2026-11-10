import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from "react";
import { Modal } from "./Dialogs";
import { SelectMenu } from "./SelectMenu";
import type { PhotoEditState, PhotoOperation } from "./photoEdit";
import "./photoEdit.css";

type Crop = { x: string; y: string; width: string; height: string };
const INITIAL: PhotoEditState = { operations: [], brightness: 0, contrast: 0, saturation: 0 };

export default function PhotoEditDialog({ bytes, name, onApply, onClose }: {
  bytes: Uint8Array; name: string; onApply: (bytes: Uint8Array) => Promise<void>; onClose: () => void;
}) {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [history, setHistory] = useState<PhotoEditState[]>([INITIAL]);
  const state = history[history.length - 1];
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preparing" | "saving" | null>(null);
  const [cropping, setCropping] = useState(false);
  const [aspect, setAspect] = useState("free");
  const [crop, setCrop] = useState<Crop>({ x: "0", y: "0", width: "1", height: "1" });
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [locked, setLocked] = useState(true);
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 });
  const engine = useRef<typeof import("./photoEdit") | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLFormElement>(null);
  const job = useRef<AbortController | null>(null);
  const active = useRef(true);
  const start = useRef<{ x: number; y: number } | null>(null);
  const size = source && engine.current ? engine.current.photoEditSize(source.width, source.height, state.operations) : { width: 1, height: 1 };
  const disabled = loading || !!busy || !source;
  const close = () => { if (busy === "saving") return; job.current?.abort(); onClose(); };
  const commit = (next: PhotoEditState) => { setHistory(previous => [...previous, next]); setError(""); };
  const operation = (op: PhotoOperation) => {
    try {
      engine.current!.photoEditSize(size.width, size.height, [op]);
      commit({ ...state, operations: [...state.operations, op] });
      setCropping(false);
    } catch (error) { setError((error as Error).message); }
  };

  useEffect(() => {
    active.current = true;
    const focused = document.activeElement as HTMLElement | null;
    const dialog = root.current!.closest<HTMLElement>(".modal")!;
    dialog.querySelector<HTMLElement>("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled)")].filter(el => el.checkVisibility());
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener("keydown", trap);
    return () => { active.current = false; job.current?.abort(); dialog.removeEventListener("keydown", trap); focused?.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController(); job.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error("Photo loading timed out. Retry or choose a smaller photo.")), 60_000);
    let image: HTMLCanvasElement | undefined;
    setLoading(true); setError(""); setSource(null);
    void (async () => {
      try {
        engine.current = await import("./photoEdit");
        controller.signal.throwIfAborted();
        image = await engine.current.loadPhotoCanvas(bytes, controller.signal);
        controller.signal.throwIfAborted();
        setSource(image); setHistory([INITIAL]);
      } catch (error) {
        if (active.current && (!controller.signal.aborted || controller.signal.reason instanceof Error)) setError(controller.signal.aborted ? controller.signal.reason.message : (error as Error).message || "Couldn't load this photo.");
      } finally {
        clearTimeout(timeout);
        if (active.current && job.current === controller) { setLoading(false); job.current = null; }
      }
    })();
    return () => { controller.abort(); clearTimeout(timeout); if (image) image.width = image.height = 0; };
  }, [bytes, retry]);

  useEffect(() => {
    if (!source || !engine.current || !preview.current) return;
    try {
      const rendered = engine.current.renderPhotoEdit(source, state, 1200);
      const output = preview.current; output.width = rendered.width; output.height = rendered.height;
      output.getContext("2d")!.drawImage(rendered, 0, 0);
      setPreviewSize({ width: rendered.width, height: rendered.height });
      rendered.width = rendered.height = 0;
      setWidth(String(size.width)); setHeight(String(size.height));
    } catch (error) { setError((error as Error).message || "Couldn't preview these edits. Undo and try again."); }
  }, [source, state]);

  const beginCrop = (ratio = aspect) => {
    const value = Number(ratio);
    let w = size.width, h = size.height;
    if (value > 0) { if (w / h > value) w = Math.max(1, Math.floor(h * value)); else h = Math.max(1, Math.floor(w / value)); }
    setCrop({ x: String(Math.floor((size.width - w) / 2)), y: String(Math.floor((size.height - h) / 2)), width: String(w), height: String(h) });
    setCropping(true); setError("");
  };
  const cropPoint = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(size.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * size.width))), y: Math.min(size.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * size.height))) };
  };
  const dragCrop = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const point = cropPoint(event), from = start.current;
    let w = Math.abs(point.x - from.x) + 1, h = Math.abs(point.y - from.y) + 1;
    const ratio = Number(aspect);
    if (ratio > 0) { if (w / h > ratio) w = Math.max(1, Math.floor(h * ratio)); else h = Math.max(1, Math.floor(w / ratio)); }
    setCrop({ x: String(point.x < from.x ? from.x - w + 1 : from.x), y: String(point.y < from.y ? from.y - h + 1 : from.y), width: String(w), height: String(h) });
  };
  const editCrop = (key: keyof Crop, value: string) => {
    setCrop(previous => {
      const next = { ...previous, [key]: value };
      const ratio = Number(aspect);
      if (ratio > 0 && value !== "" && Number.isFinite(Number(value))) {
        if (key === "width") next.height = String(Math.max(1, Math.round(Number(value) / ratio)));
        if (key === "height") next.width = String(Math.max(1, Math.round(Number(value) * ratio)));
      }
      return next;
    });
  };
  const resize = (key: "width" | "height", value: string) => {
    if (key === "width") { setWidth(value); if (locked && value !== "") setHeight(String(Math.max(1, Math.round(Number(value) * size.height / size.width)))); }
    else { setHeight(value); if (locked && value !== "") setWidth(String(Math.max(1, Math.round(Number(value) * size.width / size.height)))); }
  };
  const save = async () => {
    if (disabled || cropping || !source || !engine.current) return;
    const controller = new AbortController(); job.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error("Photo processing timed out. Try smaller dimensions.")), 60_000);
    setBusy("preparing"); setError("");
    try {
      const output = await engine.current.createPhotoEditPdf(source, state, controller.signal);
      controller.signal.throwIfAborted();
      clearTimeout(timeout); setBusy("saving");
      await onApply(output);
      if (active.current) onClose();
    } catch (error) {
      if (active.current) setError(controller.signal.aborted ? controller.signal.reason instanceof Error ? controller.signal.reason.message : "Photo editing cancelled." : (error as Error).message || "Couldn't save this copy. Try again.");
    } finally { clearTimeout(timeout); if (job.current === controller) job.current = null; if (active.current) setBusy(null); }
  };
  const numericCrop = Object.fromEntries(Object.entries(crop).map(([key, value]) => [key, value.trim() ? Number(value) : NaN])) as Record<keyof Crop, number>;
  const cropValid = Object.values(numericCrop).every(Number.isFinite);

  return <Modal title="Edit photo" onClose={close}>
    <form noValidate className="photo-editor" ref={root} onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="photo-editor-name">{name}</p>
      <p className="photo-editor-note">Your original stays unchanged. Apply edits, then use Save PNG to save a copy. Existing marks become part of the edited image.</p>
      {loading && <p role="status">Loading photo…</p>}
      {!loading && !source && <button type="button" className="btn ghost" onClick={() => setRetry(value => value + 1)}>Retry loading</button>}
      <div className="photo-editor-layout">
        <div className="photo-editor-preview">
          <div className={`photo-editor-image${cropping ? " cropping" : ""}`} style={{ aspectRatio: `${previewSize.width} / ${previewSize.height}`, "--photo-ratio": previewSize.width / previewSize.height } as CSSProperties}
            onPointerDown={event => { if (!cropping || disabled) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); start.current = cropPoint(event); dragCrop(event); }}
            onPointerMove={dragCrop} onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>
            <canvas ref={preview} aria-label="Live photo preview" />
            {cropping && cropValid && <div className="photo-editor-crop" aria-hidden="true" style={{ left: `${numericCrop.x / size.width * 100}%`, top: `${numericCrop.y / size.height * 100}%`, width: `${numericCrop.width / size.width * 100}%`, height: `${numericCrop.height / size.height * 100}%` }} />}
          </div>
          {source && <p className="photo-editor-dimensions" role="status">{size.width} × {size.height} px{cropping ? " · Drag to select, or enter the crop below." : ""}</p>}
        </div>
        <fieldset className="photo-editor-controls" disabled={disabled}>
          <div className="photo-editor-buttons">
            <button className="btn ghost" type="button" disabled={cropping} onClick={() => operation({ kind: "rotate", turns: 3 })}>Rotate left</button>
            <button className="btn ghost" type="button" disabled={cropping} onClick={() => operation({ kind: "rotate", turns: 1 })}>Rotate right</button>
            <button className="btn ghost" type="button" disabled={cropping} onClick={() => operation({ kind: "flip", axis: "horizontal" })}>Flip horizontal</button>
            <button className="btn ghost" type="button" disabled={cropping} onClick={() => operation({ kind: "flip", axis: "vertical" })}>Flip vertical</button>
          </div>
          <section aria-label="Crop photo" className="photo-editor-section">
            {!cropping ? <button className="btn ghost" type="button" onClick={() => beginCrop()}>Crop…</button> : <>
              <label>Aspect ratio<SelectMenu label="Crop aspect ratio" value={aspect} onChange={value => { setAspect(value); beginCrop(value); }} options={[{ value: "free", label: "Free" }, { value: "1", label: "Square · 1:1" }, { value: String(4 / 3), label: "4:3" }, { value: String(3 / 4), label: "3:4" }, { value: String(16 / 9), label: "16:9" }]} /></label>
              <div className="photo-editor-grid">{(["x", "y", "width", "height"] as const).map(key => <label key={key}>{key === "x" ? "Left" : key === "y" ? "Top" : key === "width" ? "Crop width" : "Crop height"}<input type="number" aria-label={key === "x" ? "Crop left" : key === "y" ? "Crop top" : `Crop ${key}`} min={key === "x" || key === "y" ? 0 : 1} step="1" value={crop[key]} onChange={event => editCrop(key, event.target.value)} /></label>)}</div>
              <div className="photo-editor-buttons"><button className="btn ghost" type="button" onClick={() => { setCropping(false); setError(""); }}>Cancel crop</button><button className="btn primary" type="button" onClick={() => operation({ kind: "crop", ...numericCrop })}>Apply crop</button></div>
            </>}
          </section>
          <section aria-label="Resize photo" className="photo-editor-section">
            <div className="photo-editor-grid"><label>Width · px<input type="number" aria-label="Photo width" min="1" max="32767" step="1" value={width} disabled={cropping} onChange={event => resize("width", event.target.value)} /></label><label>Height · px<input type="number" aria-label="Photo height" min="1" max="32767" step="1" value={height} disabled={cropping} onChange={event => resize("height", event.target.value)} /></label></div>
            <label className="photo-editor-lock"><input type="checkbox" checked={locked} disabled={cropping} onChange={event => setLocked(event.target.checked)} />Keep proportions</label>
            <button type="button" className="btn ghost" disabled={cropping} onClick={() => operation({ kind: "resize", width: width.trim() ? Number(width) : NaN, height: height.trim() ? Number(height) : NaN })}>Apply size</button>
          </section>
          <section aria-label="Adjust colors" className="photo-editor-section">
            {(["brightness", "contrast", "saturation"] as const).map(key => <label className="photo-editor-adjustment" key={key}>{key[0].toUpperCase() + key.slice(1)}<output>{state[key]}</output><input type="range" aria-label={key[0].toUpperCase() + key.slice(1)} min="-100" max="100" value={state[key]} disabled={cropping} onChange={event => commit({ ...state, [key]: Number(event.target.value) })} /></label>)}
            <button type="button" className="btn ghost" disabled={cropping || !(state.brightness || state.contrast || state.saturation)} onClick={() => commit({ ...state, brightness: 0, contrast: 0, saturation: 0 })}>Reset colors</button>
          </section>
        </fieldset>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p role="status">{busy === "preparing" ? "Preparing edited copy…" : "Applying edits…"}</p>}
      <div className="form-actions photo-editor-actions"><button type="button" className="btn ghost" disabled={disabled || cropping || history.length < 2} onClick={() => { setHistory(previous => previous.slice(0, -1)); setError(""); }}>Undo</button><button type="button" className="btn ghost" disabled={busy === "saving"} onClick={close}>Cancel</button><button className="btn primary" type="submit" disabled={disabled || cropping}>Apply edits</button></div>
    </form>
  </Modal>;
}
