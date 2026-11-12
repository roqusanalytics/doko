import { useEffect, useRef, useState, type ReactNode } from "react";
import { SelectMenu } from "./SelectMenu";
import { Modal } from "./Dialogs";
import { WINDOW_TRANSPARENCY_KEY, saveWindowTransparency } from "./appearance";
import { readSetting } from "./preferences";
import { AppearanceSettings } from "./AppearanceSettings";
import { CLAUDE_CODE_URL, PROVIDERS, savedProvider, saveAiPreference, signInChatGPT, USAGE_URL, type AiProvider } from "./ai";
import { OpenRouterSettings } from "./OpenRouterSettings";
import { updateSummary } from "./updates";
import { ScanLanguagePicker } from "./ScanLanguagePicker";
import type { ScanLanguage } from "./scanLanguage";
import { Icon } from "./icons";
import { clearStoredData, countStoredData, onStoredDataCleared, type StoredCategory } from "./recent";

/** One place for every Doko preference. */
interface Props {
  initialSection?: "General" | "Ask AI";
  theme: string;
  onTheme: (theme: "light" | "dark") => void;
  night: boolean;
  onNight: (on: boolean) => void;
  wheelPaging: boolean;
  onWheelPaging: (on: boolean) => void;
  scanLanguages: ScanLanguage[];
  onScanLanguages: (languages: ScanLanguage[]) => void;
  onOpenChangelog: () => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { id: T; name: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented small" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

const storedCategories = {
  notes: { label: "Saved annotations", action: "Clear annotations", question: "Clear all saved annotations?",
    detail: "This permanently removes the highlights, drawings, text boxes, notes, and bookmarks Doko saved on this device. Your PDF files are kept." },
  ai: { label: "Ask AI conversations", action: "Clear chats", question: "Clear all saved chats?",
    detail: "This permanently removes the Ask AI conversations Doko saved on this device." },
} as const;

function StoredData() {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof countStoredData>> | null>(null);
  const [confirm, setConfirm] = useState<StoredCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const summary = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await countStoredData();
        if (active) setCounts(next);
      } catch {
        if (active) setError("Couldn't count stored documents. Close and reopen this section to try again.");
      }
    };
    void refresh();
    const stop = onStoredDataCleared(() => void refresh());
    return () => { active = false; stop(); };
  }, [open]);

  const cancel = () => { setConfirm(null); trigger.current?.focus(); };
  const clear = async (kind: StoredCategory) => {
    setBusy(true);
    setError("");
    try {
      await clearStoredData(kind);
      setCounts(current => current && { ...current, [kind]: 0 });
      setConfirm(null);
      summary.current?.focus();
    } catch { setError("Couldn't clear the saved data. Try again."); }
    finally { setBusy(false); }
  };

  return <details className="settings-section stored-data" onToggle={event => {
    setOpen(event.currentTarget.open);
    if (!event.currentTarget.open) { setConfirm(null); setError(""); setCounts(null); }
  }}>
    <summary ref={summary}><Icon name="chevronRight" size={15} />Stored data</summary>
    {open && <div className="stored-body">
      <p className="stored-hint">Includes documents no longer in Recent.</p>
      {(["notes", "ai"] as const).map(kind => {
        const { label, action } = storedCategories[kind];
        const count = counts?.[kind];
        return <Row key={kind} label={label} hint={count === undefined ? "…" : `${count} document${count === 1 ? "" : "s"}`}>
          <button className="btn ghost" disabled={!count || busy} onClick={event => {
            trigger.current = event.currentTarget;
            setError("");
            setConfirm(kind);
          }}>{action}…</button>
        </Row>;
      })}
      {confirm && <div key={confirm} className="stored-confirm" role="alertdialog" aria-labelledby="stored-question" aria-describedby="stored-detail"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (!busy) cancel(); } }}>
        <strong id="stored-question">{storedCategories[confirm].question}</strong>
        <p id="stored-detail">{storedCategories[confirm].detail}</p>
        <button className="btn ghost" autoFocus disabled={busy} onClick={cancel}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void clear(confirm)}>{storedCategories[confirm].action}</button>
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>}
  </details>;
}

export function UpdateSettings() {
  const desktop = window.folioDesktop;
  const [error, setError] = useState<string | null>(null);
  // Updates
  const [info, setInfo] = useState<Awaited<ReturnType<FolioDesktop["getAppInfo"]>> | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [autoUpdate, setAutoUpdate] = useState<boolean | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    desktop.getAppInfo().then((i) => { if (!cancelled) setInfo(i); }).catch(() => {});
    desktop.getAutoUpdateEnabled().then((on) => { if (!cancelled) setAutoUpdate(on); }).catch(() => {});
    const unsubscribe = desktop.onUpdateStatus(setStatus);
    return () => { cancelled = true; unsubscribe?.(); };
  }, [desktop]);
  // Installed Windows copies and Linux AppImages update themselves; Macs check and offer the download.
  const updatable = !!info && (info.mode === "installed" || info.mode === "appimage" || (info.mode === "development" && status.state !== "unsupported"));
  // Unsigned Mac builds only announce updates (with a download link); signed ones install them.
  const notifyOnly = !!info?.notifyOnly;

  if (!desktop) return null;
  return <>
    <Section title="Updates">
      {updatable && (
        <Row label="Automatic updates" hint={autoUpdate === false
          ? "Off: no background checks or downloads. You can still check manually."
          : notifyOnly
            ? "Doko checks for new versions and lets you know; download them from the releases page."
            : "Downloads updates in the background and installs them when Doko closes."}>
          <Switch label="Automatic updates" checked={autoUpdate === true} disabled={autoUpdate === null || savingUpdate} onChange={async (on) => {
            setSavingUpdate(true);
            setError(null);
            try { setAutoUpdate(await desktop.setAutoUpdateEnabled(on)); }
            catch { setError("Couldn't save the update setting. Try again."); }
            finally { setSavingUpdate(false); }
          }} />
        </Row>
      )}
      <Row label={`Doko ${info?.version ?? ""}`.trim()} hint={updateSummary(status) || (status.checkedAt ? `Last checked ${new Date(status.checkedAt).toLocaleString()}` : undefined)}>
        {updatable ? (
          <button className="btn ghost" disabled={status.state === "checking" || status.state === "downloading"}
            onClick={() => status.state === "ready" ? desktop.installUpdate() : status.state === "available" ? void desktop.openDownload() : desktop.checkForUpdates()}>
            {status.state === "ready" ? "Restart and update" : status.state === "available" ? `Download ${status.version}` : "Check for updates"}
          </button>
        ) : null}
      </Row>
    </Section>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}

export function SettingsDialog({ initialSection = "General", theme, onTheme, night, onNight, wheelPaging, onWheelPaging, scanLanguages, onScanLanguages, onOpenChangelog, onClose }: Props) {
  const desktop = window.folioDesktop;
  const ai = desktop?.ai;
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<"General" | "Ask AI" | "Storage">(initialSection);

  const [windowTransparency, setWindowTransparency] = useState(() => readSetting(WINDOW_TRANSPARENCY_KEY) === "true");
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === WINDOW_TRANSPARENCY_KEY || event.key === null) setWindowTransparency(readSetting(WINDOW_TRANSPARENCY_KEY) === "true");
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  // Ask AI
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [provider, setProvider] = useState(savedProvider);
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    if (section !== "Ask AI") return;
    let current = true;
    void ai?.status().then(value => { if (current) setAiStatus(value); })
      .catch(() => { if (current) setError("Couldn't check the provider connections."); });
    return () => { current = false; };
  }, [ai, section]);

  // Signature
  const [savedSignature, setSavedSignature] = useState(() => {
    try { return !!localStorage.getItem("folio:signature"); } catch { return false; }
  });

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {(["General", "Ask AI", "Storage"] as const).filter(name => name !== "Ask AI" || ai).map(name =>
            <button key={name} type="button" aria-current={section === name ? "page" : undefined}
              onClick={() => { setSection(name); setError(null); }}>{name}</button>)}
        </nav>
        {section === "General" && <><Section title="Appearance">
          <Row label="Theme">
            <Choice label="Theme" value={theme === "dark" ? "dark" : "light"} onChange={onTheme}
              options={[{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }]} />
          </Row>
          <Row label="Window transparency" hint="Translucent frame and navigation. Panels and documents stay opaque. Uses the system backdrop where supported; accessibility settings take priority.">
            <Switch label="Window transparency" checked={windowTransparency} onChange={enabled => {
              if (saveWindowTransparency(enabled)) { setWindowTransparency(enabled); setError(null); }
              else setError("Couldn't save this preference. Try again.");
            }} />
          </Row>
          <AppearanceSettings dark={theme === "dark"} />
          <Row label="PDF dark mode" hint="Dims bright pages for night reading. Images keep their colors.">
            <Switch label="PDF dark mode" checked={night} onChange={onNight} />
          </Row>
        </Section>

        <Section title="Reading">
          <Row label="Scroll one page at a time" hint="Turn a page with each mouse wheel click or trackpad swipe.">
            <Switch label="Scroll one page at a time" checked={wheelPaging} onChange={onWheelPaging} />
          </Row>
          <Row label="Scan languages" hint="Download languages once to recognize scans offline.">
            <ScanLanguagePicker value={scanLanguages} onChange={onScanLanguages} />
          </Row>
        </Section>

        </>}

        {ai && section === "Ask AI" && (
          <section className="settings-section">
            <Row label="Provider">
              <SelectMenu label="Ask AI provider" className="ai-provider" value={provider} onChange={value => {
                const next = value as AiProvider;
                setProvider(next); setError(null); saveAiPreference("folio:ai-provider", next);
              }} options={Object.entries(PROVIDERS).map(([value, label]) => ({ value, label }))} />
            </Row>
            {provider === "chatgpt" && <Row
              label="ChatGPT"
              hint={!aiStatus ? "Checking…" : aiStatus.chatgpt.connected
                ? <>Signed in{aiStatus.chatgpt.email ? ` as ${aiStatus.chatgpt.email}` : ""}. Uses your ChatGPT plan · <a href={USAGE_URL} target="_blank" rel="noreferrer">Manage usage</a></>
                : "Use your ChatGPT plan (Go, Plus, or Pro). No API key needed."}
            >
              {aiStatus?.chatgpt.connected ? (
                <button className="btn ghost" onClick={async () => setAiStatus({ ...aiStatus, chatgpt: await ai!.signOutChatGPT() })}>Sign out</button>
              ) : (
                <button className="btn primary" disabled={!aiStatus} onClick={async () => {
                  setSigningIn(true);
                  setError(null);
                  const result = await signInChatGPT(ai!);
                  setSigningIn(false);
                  setError(result.error);
                  setAiStatus(result.status);
                }}>{signingIn ? "Open the sign-in page again" : "Continue with ChatGPT"}</button>
              )}
            </Row>}
            {provider === "claude" && <Row
              label="Claude"
              hint={!aiStatus ? "Checking…" : !aiStatus.claude.installed
                ? <>Uses your Claude subscription through <a href={CLAUDE_CODE_URL} target="_blank" rel="noreferrer">Claude Code</a>. Install it and sign in once.</>
                : aiStatus.claude.loggedIn
                  ? `Claude Code ${aiStatus.claude.version ?? ""} is signed in${aiStatus.claude.subscription ? " with your Claude subscription" : ""}.`
                  : "Claude Code is installed but not signed in. Run claude in a terminal and sign in."}
            >
              <button className="btn ghost" disabled={!aiStatus} onClick={async () => setAiStatus({ ...aiStatus!, claude: await ai!.recheckClaude() })}>Check again</button>
            </Row>}
            {provider === "openrouter" && (aiStatus ? <OpenRouterSettings ai={ai} configured={!!aiStatus.openrouter?.configured}
              onConfigured={configured => setAiStatus({ ...aiStatus, openrouter: { configured } })} /> : <p className="settings-hint">Checking connection…</p>)}
          </section>
        )}

        {section === "Storage" && <><StoredData /><Section title="Signature">
          <Row label="Remembered signature" hint={savedSignature
            ? "Saved on this computer (unencrypted) for quick signing."
            : "None. You can choose to remember one when you sign a document."}>
            <button className="btn ghost" disabled={!savedSignature} onClick={() => {
              try { localStorage.removeItem("folio:signature"); setSavedSignature(false); }
              catch { setError("Couldn't forget the signature. Please try again."); }
            }}>Forget</button>
          </Row>
        </Section></>}

        {desktop && section === "General" && (
          <UpdateSettings />
        )}

        {section === "General" && <Section title="About">
          <Row label="What's new" hint="Changes in each version of Doko.">
            <button className="btn ghost" onClick={onOpenChangelog}>View changelog</button>
          </Row>
        </Section>}

        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
