import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyImage } from "./clipboard";
import type { ReaderContext } from "./documentTabs";
import { Icon } from "./icons";
import "./screenshot.css";

type Shot = { blob: Blob; name: string; url: string; copied: boolean };
function shotName() {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `Screenshot ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}

/** Select the desktop in a separate sandboxed window; only the selected PNG reaches the reader. */
export function ScreenshotButton({ tabs }: { tabs: ReaderContext["tabs"] }) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const desktop = window.folioDesktop;
  useEffect(() => () => { void window.folioDesktop?.cancelScreenshot(); }, []);
  const shotUrl = shot?.url;
  useEffect(() => () => { if (shotUrl) URL.revokeObjectURL(shotUrl); }, [shotUrl]);
  if (!desktop?.captureDesktop) return null;

  const start = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      const png = await desktop.captureDesktop();
      if (png) {
        const blob = new Blob([png], { type: "image/png" });
        const copied = await copyImage(blob);
        setShot({ blob, name: shotName(), url: URL.createObjectURL(blob), copied });
      } else button.current?.focus({ preventScroll: true });
    } catch (failure) {
      console.error("Screenshot capture failed", failure);
      setError(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Couldn't capture the screen. Try again.");
    } finally { running.current = false; setBusy(false); }
  };
  const close = () => { setShot(null); button.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={button} className="icon-btn screenshot-btn" disabled={busy} title="Screenshot" aria-label="Take a screenshot" onClick={() => void start()}>
      <Icon name="screenshot" size={16} />
    </button>
    {error && <div className="screenshot-error" role="alert" aria-live="assertive">
      <strong>Couldn't capture the screen</strong><p>{error}</p><p>Your documents are safe.</p>
      <button className="pop-btn" onClick={() => void start()}>Try again</button>
      <button className="pop-btn" onClick={() => { setError(""); button.current?.focus(); }}>Dismiss</button>
    </div>}
    {shot && createPortal(<ScreenshotPreview shot={shot} setShot={setShot} tabs={tabs} onClose={close}
      onRetry={() => { close(); void start(); }} />, document.body)}
  </>;
}

function ScreenshotPreview({ shot, setShot, tabs, onClose, onRetry }: {
  shot: Shot; setShot(shot: Shot): void; tabs: ReaderContext["tabs"]; onClose(): void; onRetry(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState(shot.copied ? "Copied. Paste it anywhere." : "Couldn't copy to the clipboard. Try Copy or save the image.");
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => { root.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const copy = async () => {
    const copied = await copyImage(shot.blob);
    setShot({ ...shot, copied });
    setMessage(copied ? "Copied. Paste it anywhere." : "Couldn't copy to the clipboard. Try again or save the image.");
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await window.folioDesktop!.saveFile({ name: shot.name, data: new Uint8Array(await shot.blob.arrayBuffer()), format: "png" });
      if (result.ok) onClose();
      else if (result.error) setMessage(result.error);
    } catch (error) {
      console.error("Screenshot save failed", error);
      setMessage("Couldn't save the screenshot. Your selection is still here. Try again.");
    } finally { setSaving(false); }
  };
  const draw = () => {
    // A blank tab is replaced during open; keep the image in the surviving shell realm.
    const blob = new (window.parent as Window & typeof globalThis).Blob([shot.blob], { type: "image/png" });
    tabs.open([{ kind: "content", name: shot.name,
      document: { kind: "gallery", name: shot.name, files: [shot.name], selected: shot.name, blobs: { [shot.name]: blob } } }]);
    onClose();
  };
  return <div ref={root} className="screenshot-overlay" role="dialog" aria-modal="true" aria-label="Screenshot">
    <div className="screenshot-preview"><img src={shot.url} alt="Selected screenshot" draggable={false} />
      <div className="screenshot-bar" role="toolbar" aria-label="Screenshot actions">
        <button className="pop-btn" onClick={() => void copy()}><Icon name={shot.copied ? "check" : "copy"} size={15} /> {shot.copied ? "Copied" : "Copy"}</button>
        <button className="pop-btn" onClick={() => void save()} disabled={saving}><Icon name="download" size={15} /> Save…</button>
        <button className="pop-btn" onClick={draw}><Icon name="pen" size={15} /> Draw</button>
        <button className="pop-btn" onClick={onRetry}>Retake</button>
        <button className="pop-btn icon-only" onClick={onClose} title="Close (Esc)" aria-label="Close"><Icon name="close" size={15} /></button>
      </div>
      <div className="screenshot-message" role="status" aria-live="polite">{message}</div>
    </div>
  </div>;
}
