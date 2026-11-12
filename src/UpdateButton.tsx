import { useEffect, useId, useState } from "react";
import { Icon, type IconName } from "./icons";
import { updateSummary } from "./updates";

/** One always-visible update button: its icon and click action follow the updater state, and hovering it
 *  (or focusing it) shows what the update contains. */
export function UpdateButton() {
  const desktop = window.folioDesktop;
  const tipId = useId();
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [app, setApp] = useState<{ version: string; notifyOnly: boolean } | null>(null);
  useEffect(() => desktop?.onUpdateStatus(setStatus), [desktop]);
  useEffect(() => { void desktop?.getAppInfo().then(setApp).catch(() => {}); }, [desktop]);
  if (!desktop) return null;

  const { state, version, percent = 0, notes } = status;
  const step: { label: string; hint: string; icon: IconName; run?: () => void } =
    state === "ready" ? { label: `Restart and install ${version}`, hint: "Click to restart and install.", icon: "install", run: () => desktop.installUpdate() }
    : state === "available" ? (app?.notifyOnly
      ? { label: `Get Doko ${version}`, hint: "Click to open the download page.", icon: "download", run: () => void desktop.openDownload() }
      : { label: `Get Doko ${version}`, hint: "Click to download and install.", icon: "download", run: () => desktop.checkForUpdates() })
    : state === "downloading" ? { label: `Downloading ${version} (${percent}%)`, hint: "", icon: "download" }
    : state === "checking" ? { label: "Checking for updates", hint: "", icon: "rotate" }
    : state === "unsupported" ? { label: "Updates", hint: "", icon: "rotate" }
    : { label: state === "error" ? "Try checking for updates again" : "Check for updates", hint: "Click to check for updates.", icon: "rotate", run: () => desktop.checkForUpdates() };
  const offered = state === "available" || state === "ready" || state === "downloading";

  return (
    <div className="update-control">
      <button type="button" className="icon-btn update-btn" data-state={state} aria-label={step.label} aria-describedby={tipId}
        aria-disabled={!step.run || undefined} onClick={() => step.run?.()}
        style={state === "downloading" ? { "--update-progress": `${percent}%` } as React.CSSProperties : undefined}>
        <Icon name={step.icon} size={18} />
        {(state === "available" || state === "ready" || state === "error") && <span className="update-dot" aria-hidden="true" />}
      </button>
      <div id={tipId} role="tooltip" className="update-tip">
        <div className="update-tip-head">
          <strong>{offered && version ? `Doko ${version}` : "Updates"}</strong>
          {app && <span>Installed {app.version}</span>}
        </div>
        <p aria-live="polite">{updateSummary(status) || "Check whether a newer Doko is available."}</p>
        {state === "downloading" && <progress max={100} value={percent} />}
        {notes && offered && <p className="update-notes">{notes}</p>}
        {step.hint && <p className="update-tip-hint">{step.hint}</p>}
      </div>
    </div>
  );
}
