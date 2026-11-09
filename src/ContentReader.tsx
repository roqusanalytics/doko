import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { DocumentTabBar } from "./DocumentTabBar";
import type { DocumentTabs } from "./documentTabs";
import { Modal } from "./Dialogs";
import { Icon } from "./icons";
import { keys } from "./platform";
import { readSetting, writeSetting } from "./preferences";
import { CONTENT_ACCEPT, localSources } from "./content-source";
import { normalizeMathDelimiters } from "./chatMath";
import { UpdateSettings } from "./SettingsDialog";
import { updateSummary } from "./updates";
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

function MarkdownPreview({ doc, text }: { doc: MarkdownDocument; text: string }) {
  const components = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: import("react").ReactNode }) => href && webLink(href)
      ? <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer noopener">{children}</a> : <span>{children}</span>,
    img: ({ src, alt }: { src?: string | Blob; alt?: string }) => <LocalImage id={doc.id} src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
  }), [doc.id]);
  return <section className="markdown-preview" aria-label="Markdown preview" tabIndex={0}>
    <div className="content-section-label">Preview</div>
    {!text ? <p className="content-empty">Your preview appears here.</p> : <ReactMarkdown skipHtml
      remarkPlugins={[[remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore", maxExpand: 1000, maxSize: 20 }]]}
      urlTransform={url => url}
      components={components}>{normalizeMathDelimiters(text)}</ReactMarkdown>}
  </section>;
}

function GalleryCard({ doc, name, root, fit, onReady }: { doc: GalleryDocument; name: string; root: HTMLElement | null; fit: boolean; onReady: (name: string) => void }) {
  const card = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!card.current || !root) return;
    const observer = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), { root, rootMargin: "100% 0px" });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    let stopped = false;
    let objectUrl = "";
    setUrl(""); setReady(false); setError("");
    if (!near) return;
    void (async () => {
      let blob = doc.blobs?.[name];
      if (!blob && doc.id && window.folioDesktop) {
        const result = await window.folioDesktop.content.image(doc.id, name);
        blob = new Blob([new Uint8Array(result.data)], { type: result.mime });
      }
      if (!blob) throw new Error("This image is no longer available.");
      if (blob.size > MAX_BYTES) throw new Error("Image is larger than 100 MiB.");
      if (stopped) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })().catch(error => { if (!stopped) setError(failure(error)); });
    return () => { stopped = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc, name, near, attempt]);
  return <figure className="gallery-card" data-file={name} ref={card}>
    <figcaption>{name}</figcaption>
    <div className="gallery-image-stage" style={size && !fit ? { width: size.width, height: size.height } : undefined}>
      {url && !error && <img src={url} alt={name} className={ready ? "" : "gallery-decoding"} onError={() => setError("Couldn't decode this image.")} onLoad={event => {
        const image = event.currentTarget;
        if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) { setError("Image exceeds 80 million pixels."); return; }
        setSize({ width: image.naturalWidth, height: image.naturalHeight }); setReady(true); onReady(name);
      }} />}
      {error ? <div className="gallery-message" role="status"><p>{error}</p><button className="btn ghost" onClick={() => setAttempt(attempt + 1)}>Retry</button></div>
        : !ready && <div className="gallery-message" role="status">{near ? "Loading image…" : name}</div>}
    </div>
  </figure>;
}

export default function ContentReader({ tabs, tabKey, initial }: { tabs: DocumentTabs; tabKey: number; initial: ContentDocument }) {
  useSyncExternalStore(tabs.subscribe, tabs.snapshot);
  const [doc, setDoc] = useState(initial);
  const [text, setText] = useState(initial.kind === "markdown" ? initial.text : "");
  const [saved, setSaved] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<"close" | "reload" | "updates" | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [mobileView, setMobileView] = useState("edit");
  const [fit, setFit] = useState(true);
  const [selected, setSelected] = useState(initial.kind === "gallery" ? initial.selected : "");
  const [refreshing, setRefreshing] = useState(false);
  const [galleryRoot, setGalleryRoot] = useState<HTMLElement | null>(null);
  const [theme, setTheme] = useState(readSetting("folio:theme") || document.documentElement.dataset.theme || "light");
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const state = useRef({ doc, text, saved });
  state.current = { doc, text, saved };
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const closeAnswer = useRef<((answer: boolean) => void) | null>(null);
  const pendingScroll = useRef(initial.kind === "gallery" ? initial.selected : "");
  const actions = useRef({ save: (_copy = false): Promise<boolean> => Promise.resolve(false), canClose: (): Promise<boolean> => Promise.resolve(true) });
  const dirty = doc.kind === "markdown" && text !== saved;
  const index = doc.kind === "gallery" ? doc.files.indexOf(selected) : -1;

  useEffect(() => window.folioDesktop?.onUpdateStatus(setUpdateStatus), []);
  useEffect(() => { tabs.markDirty(tabKey, dirty); }, [tabs, tabKey, dirty]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (tabs.active === tabKey) window.folioDesktop?.setTheme(theme);
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
            setError(result.error || (result.conflict ? "This file changed outside Folio. Save a copy or reload it." : "Couldn't save. Your changes are still here."));
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
      open(source) {
        if (source.kind !== "content") return;
        const next = source.document;
        if (next.kind === "gallery") { setDoc(next); setSelected(next.selected); pendingScroll.current = next.selected; }
      },
      flush: async () => {},
      canClose: () => actions.current.canClose(),
    });
    return () => { closeAnswer.current?.(false); };
  }, [tabs, tabKey]);

  const scrollTo = (name: string) => {
    const target = Array.from(galleryRoot?.querySelectorAll<HTMLElement>(".gallery-card") ?? []).find(card => card.dataset.file === name);
    if (target && galleryRoot) galleryRoot.scrollTo({ top: galleryRoot.scrollTop + target.getBoundingClientRect().top - galleryRoot.getBoundingClientRect().top - 16, behavior: "instant" });
  };
  useLayoutEffect(() => {
    if (doc.kind === "gallery" && galleryRoot && pendingScroll.current) scrollTo(pendingScroll.current);
  }, [doc, galleryRoot, fit]);
  const move = (direction: number) => {
    if (doc.kind !== "gallery") return;
    const next = doc.files[Math.max(0, Math.min(doc.files.length - 1, index + direction))];
    if (next) { pendingScroll.current = next; setSelected(next); scrollTo(next); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (tabs.active !== tabKey || dialog) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && state.current.doc.kind === "markdown") {
        event.preventDefault(); void actions.current.save();
      } else if (state.current.doc.kind === "gallery" && !event.ctrlKey && !event.metaKey && !event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)
        && !(event.target instanceof Element && event.target.closest("input,textarea,[role=tab]"))) {
        event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const openFiles = async (files: File[]) => {
    try { tabs.open(await localSources(files)); } catch (error) { setError(failure(error)); }
  };
  const refresh = async () => {
    if (doc.kind !== "gallery" || !doc.id || !window.folioDesktop || refreshing) return;
    setRefreshing(true); setError("");
    try {
      const next = await window.folioDesktop.content.refresh(doc.id, selected);
      setDoc(next); setSelected(next.selected); pendingScroll.current = next.selected;
    } catch (error) { setError(failure(error)); }
    finally { setRefreshing(false); }
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
    <header className="topbar content-topbar">
      <div className="topbar-left">
        <button className="brand" title="Back to library" onClick={() => tabs.library()}><span className="brand-mark" /><span className="brand-name">Folio</span></button>
        <div className="doc-title" title={doc.name}><span>{doc.name}</span>{dirty && <span className="dirty-dot" aria-label="Unsaved changes" role="img" />}</div>
      </div>
      <div className="topbar-right">
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
      {doc.kind === "markdown" ? <>
        <div className="content-toolbar">
          <div className="segmented markdown-view-switch" aria-label="Markdown view">
            <button className={mobileView === "edit" ? "on" : ""} aria-pressed={mobileView === "edit"} onClick={() => setMobileView("edit")}>Edit</button>
            <button className={mobileView === "preview" ? "on" : ""} aria-pressed={mobileView === "preview"} onClick={() => setMobileView("preview")}>Preview</button>
          </div>
          <span className="content-save-status" role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>
          <div className="content-toolbar-actions">
            {doc.id && <button className="btn ghost" disabled={saving} onClick={() => void save(true)}>Save copy</button>}
            <button className="btn primary" title={keys("Save (Ctrl+S)")} disabled={saving} onClick={() => void save()}>{doc.id ? "Save" : "Save copy"}</button>
          </div>
        </div>
        {error && <div className="content-notice" role="alert"><span>{error}</span>{conflict && <button className="btn ghost" disabled={saving} onClick={() => setDialog("reload")}>Reload from disk</button>}</div>}
        <div className="markdown-workspace" data-view={mobileView}>
          <section className="markdown-editor" aria-label="Markdown editor"><label className="content-section-label" htmlFor="markdown-source">Markdown</label>
            <textarea ref={editor} id="markdown-source" aria-label="Markdown source" value={text} spellCheck={false} onChange={event => {
              state.current.text = event.target.value; setText(event.target.value); tabs.markDirty(tabKey, event.target.value !== state.current.saved);
            }} /></section>
          <MarkdownPreview doc={doc} text={text} />
        </div>
      </> : <>
        <div className="content-toolbar gallery-toolbar">
          <div className="content-toolbar-actions">
            <button className="icon-btn" aria-label="Previous image" disabled={index <= 0} onClick={() => move(-1)}><Icon name="chevronLeft" /></button>
            <output aria-label="Image position">{index < 0 ? 0 : index + 1} / {doc.files.length}</output>
            <button className="icon-btn" aria-label="Next image" disabled={index < 0 || index >= doc.files.length - 1} onClick={() => move(1)}><Icon name="chevronRight" /></button>
          </div>
          <span className="gallery-active-name" title={selected}>{selected}</span>
          <div className="content-toolbar-actions">
            <div className="segmented" aria-label="Image size"><button className={fit ? "on" : ""} aria-pressed={fit} onClick={() => { pendingScroll.current = selected; setFit(true); }}>Fit</button><button className={!fit ? "on" : ""} aria-pressed={!fit} onClick={() => { pendingScroll.current = selected; setFit(false); }}>100%</button></div>
            {doc.id && <button className="btn ghost" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Refreshing…" : "Refresh"}</button>}
          </div>
        </div>
        {error && <div className="content-notice" role="alert"><span>{error}</span><button className="btn ghost" onClick={() => void refresh()}>Retry</button></div>}
        {!doc.id && <div className="content-browser-note">Browser edition: only the images you selected are available.</div>}
        <section className="gallery-scroll" aria-label="Image gallery" tabIndex={0} ref={setGalleryRoot} data-fit={fit} onScroll={() => {
          if (!galleryRoot) return;
          pendingScroll.current = "";
          const top = galleryRoot.getBoundingClientRect().top;
          const cards = Array.from(galleryRoot.querySelectorAll<HTMLElement>(".gallery-card"));
          const active = galleryRoot.scrollHeight - galleryRoot.scrollTop - galleryRoot.clientHeight <= 2
            ? cards.at(-1) : cards.find(card => card.getBoundingClientRect().bottom > top + 48) ?? cards.at(-1);
          if (active?.dataset.file) setSelected(active.dataset.file);
        }}>
          {!doc.files.length && <p className="content-empty">No supported images remain in this folder.</p>}
          {doc.files.map(name => <GalleryCard key={name} doc={doc} name={name} root={galleryRoot} fit={fit} onReady={name => {
            if (pendingScroll.current === name) { scrollTo(name); pendingScroll.current = ""; }
          }} />)}
        </section>
      </>}
    </main>
    <input type="file" ref={input} hidden multiple accept={CONTENT_ACCEPT} onChange={event => {
      void openFiles(Array.from(event.target.files ?? [])); event.target.value = "";
    }} />
    {dialog === "updates" && <Modal title="Updates" onClose={cancelDialog}><div className="settings"><UpdateSettings /></div></Modal>}
    {dialog && dialog !== "updates" && <Modal title={dialog === "close" ? "Unsaved changes" : "Reload from disk"} onClose={cancelDialog}>
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
