import { keys } from "./platform";
import { activeDocument, setActiveDocument } from "./session";
import { getRecent } from "./recent";

export type OpenSource =
  | { kind: "content"; name: string; document: ContentDocument }
  | { kind: "bytes"; name: string; data: Uint8Array; note?: string; password?: string }
  | { kind: "blob"; name: string; blob: Blob; recentId?: string }
  | { kind: "word"; name: string; file: File }
  | { kind: "workbook"; name: string; file: File }
  | { kind: "url"; name: string; url: string }
  | { kind: "sample" | "converting"; name: string }
  | { kind: "error"; name: string; message: string };

interface Reader {
  open(source: OpenSource): void;
  flush(): Promise<void>;
  suspend?(): Promise<OpenSource | undefined>;
  canClose?(): Promise<boolean>;
}

export interface ReaderContext { tabs: DocumentTabs; key: number }
export interface ReaderFrame extends HTMLIFrameElement { readerContext?: ReaderContext; disposeReader?: () => void }

interface Tab {
  key: number;
  name: string;
  contentId?: string;
  content?: ContentDocument;
  dirty: boolean;
  frame?: ReaderFrame;
  reader?: Reader;
  source?: OpenSource;
  closing?: boolean;
  suspending?: boolean;
  suspendTimer?: number;
}

/** pdf.js installs editing, selection and clipboard handlers on its window. Give each live
 * reader its own document so a shortcut or undo can never edit a background PDF. */
export class DocumentTabs {
  private entries: Tab[] = [];
  private sequence = 0;
  private listeners = new Set<() => void>();
  private revision = 0;
  private linkHintSeen = false;
  private preparingClose?: Promise<boolean>;
  private closeCancelled = false;
  active = 0;
  keyboardFocus?: number;
  constructor(private root: HTMLElement) {}

  /** Reader frames share the hint, even if this window cannot use persistent storage. */
  takeLinkHint() {
    if (this.linkHintSeen) return false;
    this.linkHintSeen = true;
    try {
      if (localStorage.getItem("folio:link-return-hint")) return false;
      localStorage.setItem("folio:link-return-hint", "1");
    } catch { /* Once per window when storage is unavailable. */ }
    return true;
  }

  get all(): readonly Tab[] { return this.entries; }
  snapshot = () => this.revision;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private changed() {
    this.revision++;
    const selected = this.entry(this.active);
    document.title = selected?.name ? selected.name + " — Doko" : "Doko";
    for (const fn of this.listeners) fn();
  }
  private entry(key: number) { return this.entries.find(tab => tab.key === key); }
  private create(): Tab {
    const tab = { key: ++this.sequence, name: "", dirty: false };
    this.entries.push(tab);
    return tab;
  }
  select(key: number, focusTab = false) {
    const next = this.entry(key);
    if (!next) return;
    if (key !== this.active && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    const previous = this.entry(this.active);
    this.active = key;
    window.clearTimeout(next.suspendTimer);
    if (previous && previous !== next) previous.suspendTimer = window.setTimeout(() => { void this.suspend(previous); }, 30_000);
    this.keyboardFocus = focusTab ? key : undefined;
    for (const tab of this.entries) if (tab.frame) {
      tab.frame.inert = tab !== next;
      tab.frame.classList.toggle("active", tab === next);
    }
    if (!next.frame) {
      const frame: ReaderFrame = document.createElement("iframe");
      frame.readerContext = { tabs: this, key };
      frame.className = "document-reader active";
      frame.title = next.name || "Library";
      frame.name = "folio-reader-" + key;
      frame.allowFullscreen = true;
      frame.src = new URL("index.html?reader", location.href).href;
      next.frame = frame;
      this.root.append(frame);
    }
    next.frame.focus({ preventScroll: true });
    if (!next.content) setActiveDocument(next.contentId ?? null);
    this.changed();
  }
  private async suspend(tab: Tab) {
    if (tab.key === this.active || tab.dirty || tab.closing || tab.suspending || !tab.reader?.suspend) return;
    const reader = tab.reader;
    tab.suspending = true;
    try {
      const source = await reader.suspend!();
      if (!source || tab.key === this.active || tab.dirty || tab.closing || tab.reader !== reader || !this.entries.includes(tab)) return;
      tab.source = source;
      tab.reader = undefined;
      tab.frame?.disposeReader?.();
      tab.frame?.remove();
      tab.frame = undefined;
    } catch { /* Keep the live reader when storage or flushing fails. */ }
    finally { tab.suspending = false; }
  }
  library() {
    const blank = this.entries.find(tab => !tab.name && !tab.closing) ?? this.create();
    this.select(blank.key);
  }
  open(sources: OpenSource[]): number {
    if (!sources.length) return this.active;
    let first = 0;
    for (const source of sources) {
      if (source.kind === "content" && source.document.id) {
        const existing = this.entries.find(tab => tab.content?.id === source.document.id);
        if (existing) {
          first ||= existing.key;
          if (source.document.kind === "gallery") {
            existing.content = source.document;
            existing.source = source;
            this.deliver(existing);
          }
          continue;
        }
      }
      const current = this.entry(this.active);
      const tab = !first && current && !current.name && !current.closing ? current : this.create();
      if (source.kind === "content") this.resetFrame(tab);
      tab.name = source.name;
      if (source.kind === "content") tab.content = source.document;
      tab.source = source;
      first ||= tab.key;
      this.deliver(tab);
    }
    this.select(first);
    return first;
  }
  // A content document needs a reader of its own, so a tab that already has a reader gets a new frame.
  private resetFrame(tab: Tab) {
    if (!tab.frame) return;
    tab.frame.disposeReader?.();
    tab.frame.remove();
    tab.frame = undefined;
    tab.reader = undefined;
  }
  private deliver(tab: Tab) {
    if (!tab.reader || !tab.source) return;
    const source = tab.source;
    tab.source = undefined;
    tab.reader.open(source);
  }
  bind(key: number, reader: Reader) {
    const tab = this.entry(key);
    if (tab) { tab.reader = reader; this.deliver(tab); }
  }
  contentFor(key: number) { return this.entry(key)?.content; }
  rename(key: number, name: string) {
    const tab = this.entry(key);
    if (!tab) return;
    tab.name = name;
    if (tab.frame) tab.frame.title = name;
    this.changed();
  }
  contentSaved(key: number, content: ContentDocument) {
    const tab = this.entry(key);
    if (!tab) return;
    if (tab.content?.id && tab.content.id !== content.id) void window.folioDesktop?.content.release(tab.content.id);
    tab.content = content;
    this.rename(key, content.name);
  }
  finishConversion(key: number, source: OpenSource) {
    const tab = this.entry(key);
    if (!tab || tab.closing) return;
    tab.name = source.name;
    if (source.kind === "content") { tab.content = source.document; this.resetFrame(tab); }
    tab.source = source;
    this.deliver(tab);
    // select() builds the content reader's frame, and announces the change itself.
    if (source.kind === "content" && key === this.active) this.select(key);
    else this.changed();
  }
  opened(key: number, id: string, name: string) {
    const tab = this.entry(key);
    if (!tab || tab.closing) return false;
    // Recent, notes and chat are keyed by content. Two editors for identical bytes would overwrite each other.
    const other = this.entries.find(candidate => candidate !== tab && !candidate.closing && candidate.contentId === id);
    if (other) {
      if (this.active === key) this.select(other.key);
      void this.close(key);
      return false;
    }
    tab.name = name;
    tab.contentId = id;
    if (tab.frame) tab.frame.title = name;
    if (this.active === key) setActiveDocument(id);
    this.changed();
    return true;
  }
  markDirty(key: number, dirty: boolean) {
    const tab = this.entry(key);
    if (tab && tab.dirty !== dirty) { tab.dirty = dirty; this.changed(); }
  }
  failed(key: number) {
    const tab = this.entry(key);
    if (tab && !tab.contentId) { tab.name = ""; if (tab.frame) tab.frame.title = "Library"; this.changed(); }
  }
  private async canClose(tab: Tab) {
    if (tab.dirty && tab.reader?.canClose) this.select(tab.key);
    return tab.reader?.canClose ? tab.reader.canClose()
      : !tab.dirty || window.confirm(`Close “${tab.name}” and discard its unsaved changes? ${keys("Press Ctrl S to save a copy first.")}`);
  }
  prepareClose(): Promise<boolean> {
    if (this.preparingClose) return this.preparingClose;
    this.closeCancelled = false;
    this.preparingClose = (async () => {
      const tabs = [...this.entries];
      for (const tab of tabs) if (!await this.canClose(tab) || this.closeCancelled) return false;
      this.setClosingBusy(true);
      for (const tab of tabs) {
        try { await tab.reader?.flush(); if (this.closeCancelled) return false; }
        catch (error) { this.select(tab.key); throw error; }
      }
      return tabs.length === this.entries.length && tabs.every(tab => this.entries.includes(tab));
    })().then(ready => {
      if (!ready) this.cancelClose();
      return ready;
    }, error => { this.cancelClose(); throw error; }).finally(() => { this.preparingClose = undefined; });
    return this.preparingClose;
  }
  private setClosingBusy(busy: boolean) {
    this.root.inert = busy;
    // Inert does not cross an iframe's document boundary, including its focused text fields.
    for (const tab of this.entries) {
      const document = tab.frame?.contentDocument;
      if (document) document.documentElement.inert = busy;
    }
  }
  cancelClose() {
    this.closeCancelled = true;
    this.setClosingBusy(false);
  }
  readerFailed(key: number) {
    const tab = this.entry(key);
    if (tab) tab.reader = { open(source) { tab.source = source; }, flush: async () => {}, canClose: async () =>
      window.confirm("This reader stopped. Unsaved changes may have been lost. Close this tab without reopening the saved document?") };
  }
  async recover(key: number) {
    const tab = this.entry(key);
    if (!tab) return;
    const recent = tab.contentId ? await getRecent(tab.contentId) : undefined;
    if (tab.contentId && !recent) throw new Error("The saved document isn't available. Close this tab and open the file again.");
    tab.reader = undefined;
    tab.dirty = false;
    tab.source = tab.content ? { kind: "content", name: tab.content.name, document: tab.content }
      : recent ? { kind: "blob", name: recent.name, blob: recent.data, recentId: recent.id } : tab.source;
    tab.frame?.disposeReader?.();
    tab.frame?.remove();
    tab.frame = undefined;
    this.select(key);
  }
  async close(key: number) {
    const tab = this.entry(key);
    if (!tab || tab.closing) return;
    tab.closing = true;
    try {
      if (!await this.canClose(tab)) { tab.closing = false; return; }
      await tab.reader?.flush();
    } catch {
      tab.closing = false;
      this.select(key);
      tab.reader?.open({ kind: "error", name: tab.name, message: "Couldn't finish saving your changes. The tab is still open." });
      return;
    }
    window.clearTimeout(tab.suspendTimer);
    const index = this.entries.indexOf(tab);
    this.entries.splice(index, 1);
    tab.frame?.disposeReader?.();
    tab.frame?.remove();
    if (tab.content?.id) void window.folioDesktop?.content.release(tab.content.id);
    if (key === this.active) {
      const next = this.entries.slice(index).find(item => !item.closing) ?? this.entries.findLast(item => !item.closing);
      this.select((next ?? this.create()).key);
    } else this.changed();
  }
  cycle(direction: number) {
    const index = this.entries.findIndex(tab => tab.key === this.active);
    this.select(this.entries[(index + direction + this.entries.length) % this.entries.length].key, true);
  }
  async start() {
    const last = activeDocument();
    this.library();
    const initial = this.revision;
    const desktop = window.folioDesktop;
    desktop?.onPrepareClose(() => this.prepareClose());
    desktop?.onCloseCancelled(() => this.cancelClose());
    desktop?.onTabCommand(command => {
      if (this.root.inert) return;
      if (command === "new") this.library();
      else if (command === "close") void this.close(this.active);
      else this.cycle(command === "next" ? 1 : -1);
    });
    const conversions = new Map<string, number>();
    desktop?.content.onOpen((document, token) => {
      const source: OpenSource = { kind: "content", name: document.name, document };
      const key = token && conversions.get(token);
      if (token && key) { conversions.delete(token); this.finishConversion(key, source); }
      else this.open([source]);
    });
    desktop?.onConverting((name, token) => conversions.set(token, this.open([{ kind: "converting", name }])));
    desktop?.onOpenFile((name, data, note, token) => {
      const source: OpenSource = { kind: "bytes", name, data, note };
      const key = token && conversions.get(token);
      if (token && key) { conversions.delete(token); this.finishConversion(key, source); }
      else this.open([source]);
    });
    desktop?.onOpenFailed((message, token) => {
      const key = conversions.get(token);
      if (key) { conversions.delete(token); this.finishConversion(key, { kind: "error", name: "", message }); }
    });
    window.addEventListener("beforeunload", event => {
      if (this.entries.some(tab => tab.dirty)) event.preventDefault();
    });
    if (await desktop?.ready() || !last || this.revision !== initial) return;
    const recent = await getRecent(last);
    if (recent && this.revision === initial) this.open([{ kind: "blob", name: recent.name, blob: recent.data, recentId: recent.id }]);
  }
}
