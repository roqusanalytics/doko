import { nativeAppearanceTheme } from "./appearance";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useFileCommands } from "./fileCommands";
import { MoreMenu } from "./MoreMenu";
import { DocumentTabBar } from "./DocumentTabBar";
import type { DocumentTabs } from "./documentTabs";
import { Modal } from "./Dialogs";
import { Icon } from "./icons";
import { keys } from "./platform";
import { trackTitlebar } from "./titlebar";
import { readSetting, writeSetting } from "./preferences";
import { CONTENT_ACCEPT, localSources } from "./content-source";
import { normalizeMathDelimiters } from "./chatMath";
import { UpdateSettings } from "./SettingsDialog";
import { updateSummary } from "./updates";
import MarkdownPane, { type MarkdownEditorHandle } from "./MarkdownPane";
import "katex/dist/katex.min.css";
import "./content-reader.css";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 80_000_000;

function failure(error: unknown) { return error instanceof Error ? error.message : "Couldn't read this file. Try again."; }
function relativeImage(src: string) { return !!src && !/^[a-z][a-z\d+.-]*:|^[\\/#]/i.test(src); }
function webLink(href: string) { return /^https?:\/\//i.test(href) || href.startsWith("#"); }

function LocalImage({ id, src, alt }: { id?: string; src: string; alt: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    let objectUrl = "";
    setUrl(""); setError("");
    if (!relativeImage(src)) { setError("Remote and absolute image paths are blocked."); return; }
    if (!id || !window.folioDesktop) { setError("Local images are available in the desktop edition."); return; }
    void window.folioDesktop.content.asset(id, src).then(result => {
      if (stopped) return;
      if (result.data.byteLength > MAX_BYTES) throw new Error("Image is larger than 100 MiB.");
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)], { type: result.mime }));
      setUrl(objectUrl);
    }).catch(error => { if (!stopped) setError(failure(error)); });
    return () => { stopped = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, src, attempt]);
  return <span className="markdown-image">
    {error ? <span role="status">{alt || "Image"}: {error} {relativeImage(src) && id && <button className="content-inline-button" onClick={() => setAttempt(attempt + 1)}>Retry</button>}</span>
      : url ? <img src={url} alt={alt} onError={() => setError("Couldn't decode this image.")} onLoad={event => {
        if (event.currentTarget.naturalWidth * event.currentTarget.naturalHeight > MAX_PIXELS) setError("Image exceeds 80 million pixels.");
      }} /> : <span role="status">Loading image…</span>}
  </span>;
}

function headingAnchors(ids: readonly string[]) {
  return () => (tree: { type: string; children?: unknown[]; data?: { hProperties?: Record<string, unknown> } }) => {
    let index = 0;
    const visit = (node: typeof tree) => {
      if (node.type === "heading") {
        const id = ids[index++];
        if (id) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
      }
      node.children?.forEach(child => visit(child as typeof tree));
    };
    visit(tree);
  };
}

function MarkdownPreview({ doc, text, headingIds }: { doc: MarkdownDocument; text: string; headingIds: readonly string[] }) {
  const anchors = useMemo(() => headingAnchors(headingIds), [headingIds]);
  const components = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: import("react").ReactNode }) => href && webLink(href)
      ? <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer noopener">{children}</a> : <span>{children}</span>,
    img: ({ src, alt }: { src?: string | Blob; alt?: string }) => <LocalImage id={doc.id} src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
  }), [doc.id]);
  return <section className="markdown-preview" aria-label="Markdown preview" tabIndex={0}>
    {!text ? <p className="content-empty">Your preview appears here.</p> : <ReactMarkdown skipHtml
      remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], anchors]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore", maxExpand: 1000, maxSize: 20 }]]}
      urlTransform={url => url}
      components={components}>{normalizeMathDelimiters(text)}</ReactMarkdown>}
  </section>;
}

export default function ContentReader({ tabs, tabKey, initial }: { tabs: DocumentTabs; tabKey: number; initial: MarkdownDocument }) {
  useSyncExternalStore(tabs.subscribe, tabs.snapshot);
  const [doc, setDoc] = useState(initial);
  const [text, setText] = useState(initial.kind === "markdown" ? initial.text : "");
  const [saved, setSaved] = useState(text);
  const [saving, setSaving] = useState(false);
  const [printMarkup, setPrintMarkup] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<"close" | "reload" | "updates" | "export" | "properties" | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [theme, setTheme] = useState(readSetting("folio:theme") || document.documentElement.dataset.theme || "light");
  const input = useRef<HTMLInputElement>(null);
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (tabs.active === tabKey && window.folioDesktop && !dialog && header.current) return trackTitlebar(header.current);
  }, [tabs.active, tabKey, dialog]);
  const editor = useRef<MarkdownEditorHandle>(null);
  const state = useRef({ doc, text, saved });
  state.current = { doc, text, saved };
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const closeAnswer = useRef<((answer: boolean) => void) | null>(null);
  const actions = useRef({ save: (_copy = false): Promise<boolean> => Promise.resolve(false), canClose: (): Promise<boolean> => Promise.resolve(true) });
  const dirty = doc.kind === "markdown" && text !== saved;

  useEffect(() => window.folioDesktop?.onUpdateStatus(setUpdateStatus), []);
  useEffect(() => { tabs.markDirty(tabKey, dirty); }, [tabs, tabKey, dirty]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (tabs.active === tabKey) window.folioDesktop?.setTheme(nativeAppearanceTheme(theme));
  }, [theme, tabs.active, tabKey, tabs]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "folio:theme" && (event.newValue === "light" || event.newValue === "dark")) setTheme(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = (copy = false): Promise<boolean> => {
    if (pendingSave.current) return pendingSave.current;
    const current = state.current;
    if (current.doc.kind !== "markdown") return Promise.resolve(true);
    const markdown = current.doc;
    setSaving(true); setError("");
    const operation = (async () => {
      try {
        if (!markdown.id || !window.folioDesktop) {
          const url = URL.createObjectURL(new Blob([current.text], { type: "text/markdown;charset=utf-8" }));
          const link = document.createElement("a"); link.href = url; link.download = markdown.name; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else {
          const result = await window.folioDesktop.content.save(markdown.id, current.text, copy);
          if (result.cancelled) return false;
          if (!result.ok || !result.document) {
            setConflict(!!result.conflict);
            setError(result.error || (result.conflict ? "This file changed outside Doko. Save a copy or reload it." : "Couldn't save. Your changes are still here."));
            return false;
          }
          setDoc(result.document); tabs.contentSaved(tabKey, result.document);
        }
        setSaved(current.text); state.current.saved = current.text;
        tabs.markDirty(tabKey, state.current.text !== current.text); setConflict(false);
        return true;
      } catch (error) { setError(failure(error)); return false; }
      finally { setSaving(false); }
    })();
    pendingSave.current = operation;
    void operation.finally(() => { pendingSave.current = null; });
    return operation;
  };
  const answerClose = (answer: boolean) => {
    setDialog(null); const resolve = closeAnswer.current; closeAnswer.current = null; resolve?.(answer);
    if (!answer) editor.current?.focus();
  };
  actions.current = { save, canClose: async () => {
    if (pendingSave.current) await pendingSave.current;
    if (state.current.doc.kind !== "markdown" || state.current.text === state.current.saved) return true;
    return new Promise(resolve => { closeAnswer.current = resolve; setDialog("close"); });
  } };
  useEffect(() => {
    tabs.bind(tabKey, {
      open() {},
      flush: async () => {},
      canClose: () => actions.current.canClose(),
    });
    return () => { closeAnswer.current?.(false); };
  }, [tabs, tabKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (tabs.active !== tabKey || dialog) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && state.current.doc.kind === "markdown") {
        event.preventDefault(); void actions.current.save(event.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const openFiles = async (files: File[]) => {
    try { tabs.open(await localSources(files)); } catch (error) { setError(failure(error)); }
  };
  const reload = async () => {
    if (doc.kind !== "markdown" || !doc.id || !window.folioDesktop) return;
    setDialog(null); setSaving(true);
    try {
      const next = await window.folioDesktop.content.reload(doc.id);
      setDoc(next); setText(next.text); setSaved(next.text); setError(""); setConflict(false);
      state.current = { doc: next, text: next.text, saved: next.text }; tabs.markDirty(tabKey, false);
    } catch (error) { setError(failure(error)); }
    finally { setSaving(false); }
  };
  const exportMarkdown = async (format: "html" | "txt", printing = false) => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const current = state.current;
      const content = format === "html" ? await (await import("./markdownExport")).markdownHtml(current.doc.name, current.text, current.doc.id) : current.text;
      if (printing) {
        const body = new DOMParser().parseFromString(content, "text/html").body.innerHTML;
        setPrintMarkup(body);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        window.print(); setPrintMarkup(""); return;
      }
      const name = current.doc.name.replace(/\.(md|markdown)$/i, "") + "." + format;
      if (window.folioDesktop) {
        const result = await window.folioDesktop.saveFile({ name, format, data: new TextEncoder().encode(content), saveAs: true });
        if (result.cancelled) return;
        if (!result.ok) throw new Error(result.error || "Couldn't save this export. Try again.");
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: format === "html" ? "text/html" : "text/plain" }));
        const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setDialog(null);
    } catch (error) { setError(failure(error)); }
    finally { setSaving(false); }
  };
  const fileCommand = (command: FileCommand) => {
    if (saving || dialog) return;
    if (command === "save" || command === "save-as") void save(command === "save-as");
    else if (command === "export") setDialog("export");
    else if (command === "print") void exportMarkdown("html", true);
    else if (command === "properties") setDialog("properties");
    else if (command === "recent") tabs.library();
  };
  useFileCommands(tabs.active === tabKey, "markdown", saving || !!dialog, fileCommand);
  const cancelDialog = () => dialog === "close" ? answerClose(false) : setDialog(null);
  useEffect(() => {
    if (!dialog) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".modal button:not(:disabled)"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", trapFocus);
    return () => window.removeEventListener("keydown", trapFocus);
  }, [dialog]);

  return <div className="app content-reader" onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault(); void openFiles(Array.from(event.dataTransfer.files));
  }}>
    <header ref={header} className="topbar content-topbar">
      <div className="topbar-left">
        <button className="brand" title="Back to library" onClick={() => tabs.library()}><span className="brand-mark" /><span className="brand-name">Doko</span></button>
        <div className="doc-title" title={doc.name}><span>{doc.name}</span>{dirty && <span className="dirty-dot" aria-label="Unsaved changes" role="img" />}</div>
      </div>
      <div className="topbar-right">
        <MoreMenu label="File" items={[
          { kind: "action", icon: "upload", label: "Open…", onSelect: () => input.current?.click() },
          { kind: "action", icon: "download", label: "Save", onSelect: () => fileCommand("save") },
          { kind: "action", icon: "download", label: "Save As…", onSelect: () => fileCommand("save-as") },
          { kind: "action", icon: "download", label: "Export / Convert…", onSelect: () => fileCommand("export") },
          { kind: "action", icon: "print", label: "Print…", onSelect: () => fileCommand("print") },
          { kind: "action", icon: "info", label: "Properties…", onSelect: () => fileCommand("properties") },
        ]} />
        {window.folioDesktop && <button className="btn ghost" onClick={() => setDialog("updates")}>Updates</button>}
        <button className="icon-btn" aria-label="Open file" title="Open file" onClick={() => input.current?.click()}><Icon name="upload" /></button>
        <button className="icon-btn" aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} title="Toggle theme" onClick={() => {
          const next = theme === "dark" ? "light" : "dark"; setTheme(next); writeSetting("folio:theme", next);
        }}><Icon name="moon" /></button>
      </div>
    </header>
    <DocumentTabBar tabs={tabs} tabKey={tabKey} />
    <main className="content-body" id="reader-panel" role="tabpanel" aria-labelledby="selected-document-tab">
      {["available", "ready", "downloading", "error"].includes(updateStatus.state) && <div className="content-notice content-update" role="status">
        <span>{updateSummary(updateStatus)}</span>
        <button className="btn ghost" disabled={updateStatus.state === "downloading"} onClick={() => {
          if (updateStatus.state === "ready") window.folioDesktop?.installUpdate();
          else if (updateStatus.state === "available") void window.folioDesktop?.openDownload();
          else window.folioDesktop?.checkForUpdates();
        }}>{updateStatus.state === "ready" ? "Restart and update" : updateStatus.state === "available" ? `Download ${updateStatus.version}` : updateStatus.state === "downloading" ? "Downloading…" : "Retry"}</button>
      </div>}
      <>
        <div className="content-toolbar">
          <span className="content-save-status" role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>
          <div className="content-toolbar-actions">
            {doc.id && <button className="btn ghost" disabled={saving} onClick={() => void save(true)}>Save copy</button>}
            <button className="btn primary" title={keys("Save (Ctrl+S)")} disabled={saving} onClick={() => void save()}>{doc.id ? "Save" : "Save copy"}</button>
          </div>
        </div>
        {error && <div className="content-notice" role="alert"><span>{error}</span>{conflict && <button className="btn ghost" disabled={saving} onClick={() => setDialog("reload")}>Reload from disk</button>}</div>}
        <MarkdownPane text={text} editorRef={editor} onChange={value => {
          state.current.text = value; setText(value); tabs.markDirty(tabKey, value !== state.current.saved);
        }} renderPreview={headingIds => <MarkdownPreview doc={doc} text={text} headingIds={headingIds} />} />
      </>
    </main>
    <input type="file" ref={input} hidden multiple accept={CONTENT_ACCEPT} onChange={event => {
      void openFiles(Array.from(event.target.files ?? [])); event.target.value = "";
    }} />
    {dialog === "updates" && <Modal title="Updates" onClose={cancelDialog}><div className="settings"><UpdateSettings /></div></Modal>}
    {printMarkup && <div className="markdown-print" dangerouslySetInnerHTML={{ __html: printMarkup }} />}
    {dialog === "export" && <Modal title="Export Markdown" onClose={() => { if (!saving) setDialog(null); }}><div className="content-dialog"><p>Export the current text as a standalone HTML document or a plain text file. Your Markdown stays unchanged.</p>
      {error && <p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button className="btn ghost" disabled={saving} onClick={() => setDialog(null)}>Cancel</button><button className="btn ghost" disabled={saving} onClick={() => void exportMarkdown("txt")}>Save text…</button><button className="btn primary" disabled={saving} onClick={() => void exportMarkdown("html")}>Save HTML…</button></div></div></Modal>}
    {dialog === "properties" && <Modal title="Properties" onClose={() => setDialog(null)}><dl className="info-list"><div><dt>File</dt><dd>{doc.name}</dd></div><div><dt>Type</dt><dd>Markdown (UTF-8)</dd></div><div><dt>Size</dt><dd>{new TextEncoder().encode(text).byteLength.toLocaleString()} bytes</dd></div><div><dt>Words</dt><dd>{text.trim() ? text.trim().split(/\s+/).length : 0}</dd></div></dl></Modal>}
    {dialog && ["close", "reload"].includes(dialog) && <Modal title={dialog === "close" ? "Unsaved changes" : "Reload from disk"} onClose={cancelDialog}>
      <div className="content-dialog">
        <p>{dialog === "close" ? `Save changes to “${doc.name}” before closing?` : "Reloading discards your unsaved changes and reads the current file from disk."}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="btn ghost" autoFocus disabled={saving} onClick={cancelDialog}>Cancel</button>
          {dialog === "close" ? <><button className="btn ghost" disabled={saving} onClick={() => answerClose(true)}>Discard</button><button className="btn primary" disabled={saving} onClick={() => void save().then(ok => { if (ok && state.current.text === state.current.saved) answerClose(true); })}>{saving ? "Saving…" : "Save"}</button></>
            : <button className="btn primary" disabled={saving} onClick={() => void reload()}>Discard and reload</button>}
        </div>
      </div>
    </Modal>}
  </div>;
}
