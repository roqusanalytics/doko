import { useEffect, useId, useRef, useState } from "react";
import { clearRecent, getRecent, listRecent, removeRecent, type RecentFile, type RecentSummary } from "./recent";
import { useAnchoredPopover } from "./anchored-popover";
import { Icon } from "./icons";
import { newCanvasAction, openDocumentTypes } from "./open-document-types";
import { keys } from "./platform";
import { formatBytes } from "./Dialogs";
import { updateSummary } from "./updates";

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function UpdateLine({ status }: { status: UpdateStatus }) {
  const desktop = window.folioDesktop!;
  const check = (
    <button className="link version-action" onClick={() => desktop.checkForUpdates()}>
      Check for updates
    </button>
  );
  switch (status.state) {
    case "ready":
      return (
        <>
          {" · "}
          <button className="link version-action" onClick={() => desktop.installUpdate()}>
            Restart to update to {status.version}
          </button>
        </>
      );
    case "latest":
      return <> · Up to date · {check}</>;
    case "error":
      return (
        <>
          <span title={status.message}> · Couldn't check for updates</span> · {check}
        </>
      );
    case "available":
      return (
        <>
          {" · "}
          <button className="link version-action" onClick={() => void desktop.openDownload()}>
            Download Doko {status.version}
          </button>
        </>
      );
    case "idle":
      return <> · {check}</>;
    default:
      return <> · {updateSummary(status)}</>;
  }
}

interface Props {
  active: boolean;
  onPick: (type?: OpenFileType) => void;
  onOpenUrl: () => void;
  onNewCanvas: () => void;
  onOpenRecent: (file: RecentFile) => void;
  onSample: () => void;
  loading: boolean;
}

function RemoveRecentButton({ files, busy, all = false, onRemove }: {
  files: RecentSummary[]; busy: boolean; all?: boolean; onRemove(): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = useId(), open = useAnchoredPopover(trigger, panel);
  return <span onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button ref={trigger} className={all ? "link" : "recent-remove"} title={all ? undefined : "Remove from recent"}
      disabled={busy} popoverTarget={id} aria-expanded={open} aria-haspopup="dialog">
      {all ? "Clear all" : <Icon name="close" size={13} />}
    </button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label="Remove recent files" className="anchored-popover recent-confirm">
      <strong>Remove {all ? "all recent files" : "this recent file"} from Doko?</strong>
      <p>Local copies will be removed. Original files stay safe. Open them again to restore these cards.</p>
      <ul>{files.map(file => <li key={file.id}>{file.name}</li>)}</ul>
      <footer>
        <button data-autofocus className="btn" onClick={() => panel.current?.hidePopover()}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => { panel.current?.hidePopover(); onRemove(); }}>Remove ({files.length})</button>
      </footer>
    </div>
  </span>;
}

export function Welcome({ active, onPick, onOpenUrl, onNewCanvas, onOpenRecent, onSample, loading }: Props) {
  const cardId = useId();
  const desktop = !!window.folioDesktop;
  const [recent, setRecent] = useState<RecentSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retry(): void } | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    window.folioDesktop?.getAppInfo().then((info) => setVersion(info.version)).catch(() => {});
    return window.folioDesktop?.onUpdateStatus?.(setUpdate);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void listRecent().then(files => { if (!cancelled) setRecent(files); });
    return () => { cancelled = true; };
  }, [active]);

  const forget = async (id?: string) => {
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      if (id) await removeRecent(id); else await clearRecent();
      setRecent(r => id ? r.filter(f => f.id !== id) : []);
    } catch (error) {
      console.error("Couldn't remove recent files", error);
      setFailure({ message: "Couldn't remove the local copies. Device storage is unavailable. Your files are safe.", retry: () => void forget(id) });
    } finally { setBusy(false); }
  };
  const openRecent = async (id: string) => {
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      const file = await getRecent(id);
      if (!file) throw new Error("The saved document is unavailable.");
      onOpenRecent(file);
    } catch (error) {
      console.error("Couldn't open a recent file", error);
      setFailure({ message: "Couldn't read this local copy. Open the original file, or try again. The original file is safe.", retry: () => void openRecent(id) });
    } finally { setBusy(false); }
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="hero">
          <h1>Read beautifully.</h1>
          <p>{desktop ? "A calm place for PDFs, Markdown, photos, and drawings." : "A calm place for PDFs, Markdown, and photos."}</p>
        </div>

        <button className="dropzone" onClick={() => onPick()} disabled={loading}>
          <div className="dropzone-icon">
            <Icon name={loading ? "file" : "upload"} size={26} />
          </div>
          <div className="dropzone-text">
            <strong>{loading ? "Opening…" : "Open a file"}</strong>
            <span>Choose files from your device</span>
          </div>
          <kbd>{keys("Ctrl O")}</kbd>
        </button>

        <div className="welcome-cards" role="group" aria-label="Document types">
          {desktop && <button type="button" className="welcome-card welcome-card-new"
            aria-label={newCanvasAction.label} aria-describedby={`${cardId}-canvasDocument`}
            disabled={loading} onClick={onNewCanvas}>
            <Icon name={newCanvasAction.icon} size={20} />
            <span className="welcome-card-copy">
              <strong>{newCanvasAction.name}<span className="welcome-card-badge" aria-hidden="true">New</span></strong>
              <span id={`${cardId}-canvasDocument`} className="welcome-card-hint">{newCanvasAction.hint}</span>
            </span>
          </button>}
          {openDocumentTypes(desktop).map(({ type, name, hint, icon }) => (
            <button key={type} type="button" className="welcome-card" aria-label={name}
              aria-describedby={`${cardId}-${type}`} disabled={loading} onClick={() => onPick(type)}>
              <Icon name={icon} size={20} />
              <span className="welcome-card-copy">
                <strong>{name}</strong>
                <span id={`${cardId}-${type}`} className="welcome-card-hint">{hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="welcome-links">
          <button className="link" onClick={onOpenUrl} disabled={loading}>
            <Icon name="link" size={15} /> Open from URL
          </button>
          <button className="link" onClick={onSample}>
            <Icon name="book" size={15} /> Try a sample document
          </button>
        </div>

        {recent.length > 0 && (
          <section className="recent">
            <div className="recent-head">
              <h3>Recent</h3>
              <RemoveRecentButton files={recent} busy={busy} all onRemove={() => void forget()} />
            </div>
            <div className="recent-grid">
              {recent.map((f) => (
                <div key={f.id} className="recent-card" onClick={() => void openRecent(f.id)} role="button" aria-disabled={busy} tabIndex={0}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openRecent(f.id); } }}>
                  <div className="recent-thumb">
                    {f.thumb ? <img src={f.thumb} alt="" /> : <Icon name="file" size={28} />}
                    {f.lastPage > 1 && (
                      <span className="recent-progress" style={{ width: `${(f.lastPage / f.pages) * 100}%` }} />
                    )}
                  </div>
                  <div className="recent-meta">
                    <strong title={f.name}>{f.name.replace(/\.pdf$/i, "")}</strong>
                    <span>
                      {timeAgo(f.openedAt)} · {f.pages} {f.pages === 1 ? "page" : "pages"} · {formatBytes(f.size)}
                    </span>
                  </div>
                  <RemoveRecentButton files={[f]} busy={busy} onRemove={() => void forget(f.id)} />
                </div>
              ))}
            </div>
          </section>
        )}
        <div aria-live="polite">
          {busy && <p role="status">Working…</p>}
          {failure && <div className="form-error" role="alert"><p>{failure.message}</p>
            <button className="btn" disabled={busy} onClick={failure.retry}>Try again</button>
          </div>}
        </div>

        {version && (
          <p className="version">
            Doko {version}
            {update && <UpdateLine status={update} />}
          </p>
        )}
      </div>
    </div>
  );
}
