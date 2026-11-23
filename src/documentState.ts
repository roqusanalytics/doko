// Draft state of the one document a reader tab holds. See "Document state" in GLOSSARY.md and docs/specs/document-state.md.

export type PageDraft = { order: number[]; copy?: Uint8Array };
export type DocumentIdentity = { id: string; name: string; sourceId?: string; saveKey: string; photoName?: string; photoKey?: string };

/** `reading` is the photo's notes and bookmarks, kept opaque with its draft. */
export type ExportedCopy = { bytes: Uint8Array; annotated: boolean; blob: Blob; reading?: unknown };

/** An edited photo kept in memory while another photo of the gallery is open. */
export type PhotoDraft = { bytes: Uint8Array; dirty: boolean; reading?: unknown };
export type PhotoDrafts = {
  /** The id of the open photo's document when it matches what was last saved or opened. */
  savedId: string;
  dirty: ReadonlySet<string>;
  drafts: ReadonlyMap<string, PhotoDraft>;
};
export type SavedCopy = { bytes: Uint8Array; blob: Blob; name: string; annotated: boolean; pageOrder: number[] | undefined };
/** What keeping the copy's notes, conversation and version history produced. */
export type RecordResult = { dataFailed: boolean; messages: string[] };

export type SaveAdapters = {
  /** The current document as file bytes; null when another export holds the document. */
  exportBytes(pageOrder: number[] | undefined): Promise<ExportedCopy | null>;
  /** Writes the file; false when the user cancelled. Throws when writing failed. */
  persist(blob: Blob, name: string, key: string, saveAs: boolean): Promise<boolean>;
  /** PDF only. Runs before the file is written and returns the step that runs after it. */
  recordSave?(pageOrder: number[] | undefined): Promise<(saved: SavedCopy) => Promise<RecordResult>>;
  /** PDF only. Opens the saved copy in place of an edited document. */
  reopen?(name: string, bytes: Uint8Array, pageOrder: number[] | undefined): Promise<void>;
};

/** The document before an operation (text marking, photo or page edits) replaced it. One level. */
export type OperationUndo = { doc: DocumentIdentity; bytes: Uint8Array; details: unknown };

export type UndoResult = { status: "undone" } | { status: "skipped" } | { status: "failed"; error: Error };

export type SaveResult =
  | { status: "skipped" } // already saving, nothing open, or the document changed while saving
  | { status: "cancelled" }
  | { status: "saved"; reopened: boolean; messages: string[] }
  | { status: "failed"; error: Error };

const pdfName = (name: string) => name.replace(/\.pdf$/i, "");

function copyNameFor(doc: DocumentIdentity | null, pageOrder: number[] | undefined) {
  return pageOrder && doc ? pdfName(doc.name) + " (reordered).pdf" : doc?.name ?? "document.pdf";
}

type Inputs = {
  doc: DocumentIdentity | null;
  saving: boolean;
  /** Bumped by every edit; a save clears dirty only if it is unchanged when the save ends. */
  revision: number;
  dirty: boolean;
  editorDirty: boolean;
  pageDraft: PageDraft | null;
  /** Storage failures are owned elsewhere; they only count towards unsaved. */
  storageError: string | null;
  aiStorageError: boolean;
  /** Null for a single document; the gallery's photo drafts when a photo folder is open. */
  photos: PhotoDrafts | null;
  /** Kept after another document opens, but then no longer applies; see canUndoOperation. */
  operationUndo: OperationUndo | null;
};

export type DocumentStateSnapshot = Readonly<Inputs & {
  /** The page order, when it differs from the document's own order. */
  pageOrder: number[] | undefined;
  /** The open photo differs from what was last saved or opened. */
  currentPhotoDirty: boolean;
  unsaved: boolean;
  /** The file name a copy of the open document gets. */
  copyName: string;
  /** The operation undo belongs to the open document. */
  canUndoOperation: boolean;
}>;

function derive(inputs: Inputs): DocumentStateSnapshot {
  const { doc, dirty, editorDirty, pageDraft, photos } = inputs;
  const pageOrder = pageDraft?.order.some((n, i) => n !== i + 1) ? pageDraft.order : undefined;
  const currentPhotoDirty = dirty || editorDirty || (!!doc && doc.id !== (photos?.savedId ?? ""));
  const unsaved = !!inputs.storageError || inputs.aiStorageError || (photos
    ? currentPhotoDirty || photos.dirty.size > 0
    : !!doc?.sourceId || dirty || editorDirty || (!!pageOrder && !pageDraft?.copy));
  return { ...inputs, pageOrder, currentPhotoDirty, unsaved, copyName: copyNameFor(doc, pageOrder),
    canUndoOperation: !!doc && inputs.operationUndo?.doc === doc };
}

export class DocumentState {
  private state: DocumentStateSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(gallery = false) {
    const photos: PhotoDrafts | null = gallery ? { savedId: "", dirty: new Set(), drafts: new Map() } : null;
    this.state = derive({
      doc: null, saving: false, revision: 0, dirty: false, editorDirty: false, pageDraft: null,
      storageError: null, aiStorageError: false, photos, operationUndo: null,
    });
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private set(patch: Partial<Inputs>) {
    const current = this.state as Inputs;
    if ((Object.keys(patch) as (keyof Inputs)[]).every(key => Object.is(current[key], patch[key]))) return;
    this.state = derive({ ...current, ...patch });
    for (const listener of this.listeners) listener();
  }

  /** A document finished opening. `reopened` keeps the page order of a document reopened after its save. */
  opened(doc: DocumentIdentity, reopened: boolean) {
    const draft = this.state.pageDraft;
    const { id, name, sourceId, saveKey, photoName, photoKey } = doc;
    this.set({ doc: { id, name, sourceId, saveKey, photoName, photoKey }, dirty: false, editorDirty: false,
      pageDraft: reopened && draft ? { order: draft.order } : null });
  }

  closed() { this.set({ doc: null }); }

  edited() { this.set({ revision: this.state.revision + 1, dirty: true }); }

  /** Clears dirty. With a revision, only when no edit happened since it was read; returns whether it cleared. */
  clean(revision?: number) {
    if (revision !== undefined && revision !== this.state.revision) return false;
    this.set({ dirty: false });
    return true;
  }

  /** Puts dirty back after a save that failed past the point where it was cleared. */
  restoreDirty() { this.set({ dirty: true }); }

  setEditorDirty = (editorDirty: boolean) => this.set({ editorDirty });

  setPageOrder = (order: number[] | null) => this.set({ pageDraft: order ? { order } : null });

  /** A reordered copy was saved; remembered only while the order is still the one that was saved. */
  savedPageCopy(order: number[], copy: Uint8Array) {
    if (this.state.pageDraft?.order === order) this.set({ pageDraft: { order, copy } });
  }

  setStorageError = (storageError: string | null) => this.set({ storageError });

  setAiStorageError = (aiStorageError: boolean) => this.set({ aiStorageError });

  /** A photo folder is open; keeps the drafts it already has. */
  showGallery() { if (!this.state.photos) this.set({ photos: { savedId: "", dirty: new Set(), drafts: new Map() } }); }

  private setPhotos(patch: Partial<PhotoDrafts>) {
    if (this.state.photos) this.set({ photos: { ...this.state.photos, ...patch } });
  }

  private keepPhoto(name: string, draft: PhotoDraft | undefined, dirty: boolean, savedId?: string) {
    const photos = this.state.photos;
    if (!photos) return;
    const drafts = new Map(photos.drafts);
    if (draft) drafts.set(name, draft);
    const dirtyPhotos = new Set(photos.dirty);
    if (dirty) dirtyPhotos.add(name); else dirtyPhotos.delete(name);
    this.setPhotos({ drafts, dirty: dirtyPhotos, ...(savedId === undefined ? {} : { savedId }) });
  }

  /** The open photo is being left for another; keeps its current bytes when it changed or already had a draft. */
  leavePhoto(bytes: Uint8Array, reading: unknown) {
    const name = this.state.doc?.photoName;
    const photos = this.state.photos;
    if (!name || !photos) return;
    const changed = this.state.currentPhotoDirty;
    this.keepPhoto(name, changed || photos.drafts.has(name) ? { bytes, dirty: changed, reading } : undefined, changed);
  }

  /** A photo finished opening; it counts as saved unless it came from a draft with unsaved changes. */
  photoOpened() {
    const { doc, photos } = this.state;
    if (!doc?.photoName || !photos) return;
    this.setPhotos({ savedId: photos.drafts.get(doc.photoName)?.dirty ? "" : doc.id });
  }

  /** The folder was read again: earlier drafts no longer apply. */
  clearPhotos() { this.setPhotos({ dirty: new Set(), drafts: new Map() }); }

  /** The photo's original left the folder. */
  forgetPhoto(name: string) {
    const photos = this.state.photos;
    if (!photos?.drafts.has(name)) return;
    const drafts = new Map(photos.drafts);
    drafts.delete(name);
    this.setPhotos({ drafts });
  }

  /** Stored notes were cleared, so drafts must not bring them back. */
  forgetPhotoReadings() {
    const photos = this.state.photos;
    if (!photos?.drafts.size) return;
    this.setPhotos({ drafts: new Map([...photos.drafts].map(([name, { reading: _, ...draft }]) => [name, draft])) });
  }

  /** An operation replaced the open document with an edited copy; `bytes` is the document before it. */
  operationApplied(bytes: Uint8Array, details: unknown) {
    const doc = this.state.doc;
    if (!doc) return;
    this.set({ revision: this.state.revision + 1, dirty: true, pageDraft: null, operationUndo: { doc, bytes, details } });
  }

  /**
   * Returns the open document to before the last operation. `reopen` opens the earlier bytes and may throw to
   * refuse; it returns false when the document could not be opened.
   */
  async undoOperation(reopen: (undo: OperationUndo) => Promise<boolean>): Promise<UndoResult> {
    const undo = this.state.operationUndo;
    if (!undo) return { status: "skipped" };
    try {
      if (!this.state.canUndoOperation) throw new Error("A newer content edit is active. Save it before returning to an earlier document version.");
      if (this.state.pageOrder) throw new Error("Finish or cancel page reordering before undoing this edit.");
      if (!await reopen(undo)) return { status: "skipped" };
      this.set({ revision: this.state.revision + 1, dirty: true, operationUndo: null });
      return { status: "undone" };
    } catch (error) {
      return { status: "failed", error: error as Error };
    }
  }

  /**
   * Saves a copy of the open document: a PDF, or for a photo an edited PNG. The original is never overwritten.
   * Dirty clears only if no edit happened while saving. An edited PDF is reopened from its saved copy.
   */
  async save(request: { format: "pdf" | "png"; saveAs: boolean }, adapters: SaveAdapters): Promise<SaveResult> {
    const doc = this.state.doc;
    const pdf = request.format === "pdf";
    if (this.state.saving || !doc || (!pdf && !doc.photoName)) return { status: "skipped" };
    const { revision, pageOrder, dirty: wasDirty } = this.state;
    const gallery = !!this.state.photos;
    const current = () => this.state.doc === doc;
    this.set({ saving: true });
    try {
      const copy = await adapters.exportBytes(pageOrder);
      if (!copy) {
        if (pdf) return { status: "skipped" };
        throw new Error("Another export is in progress. Try again.");
      }
      if (!current()) return { status: "skipped" };
      let name: string;
      let key: string;
      if (pdf) {
        const base = copyNameFor(doc, pageOrder);
        name = doc.sourceId ? pdfName(base) + " (edited).pdf" : base;
        if (!/\.pdf$/i.test(name)) name += ".pdf";
        key = `${doc.photoKey ?? doc.saveKey}:pdf`;
      } else {
        name = doc.photoName!.replace(/\.[^.]+$/, "") + " (edited).png";
        key = `${doc.photoKey}:png`;
      }
      const record = pdf ? await adapters.recordSave?.(pageOrder) : undefined;
      if (!current()) return { status: "skipped" };
      if (!await adapters.persist(copy.blob, name, key, request.saveAs)) return { status: "cancelled" };
      if (this.clean(revision) && doc.photoName) {
        this.keepPhoto(doc.photoName, { bytes: copy.bytes, dirty: false, reading: copy.reading }, false, doc.id);
      }
      if (!pdf) return { status: "saved", reopened: false, messages: ["Saved an edited PNG copy. Original unchanged."] };

      const recorded = record
        ? await record({ bytes: copy.bytes, blob: copy.blob, name, annotated: copy.annotated, pageOrder })
        : { dataFailed: false, messages: [] };
      if (!current()) return { status: "skipped" };
      if (doc.sourceId && !gallery && !recorded.dataFailed && adapters.reopen) {
        await adapters.reopen(name, copy.bytes, pageOrder);
        return { status: "saved", reopened: true, messages: recorded.messages };
      }
      let message = copy.annotated ? "Saved a copy with your highlights and notes" : "File saved";
      if (pageOrder) {
        this.savedPageCopy(pageOrder, copy.bytes);
        message = "Saved reordered copy";
      }
      return { status: "saved", reopened: false, messages: [message, ...recorded.messages] };
    } catch (error) {
      if (!current()) return { status: "skipped" };
      if (pdf && wasDirty) this.restoreDirty();
      return { status: "failed", error: error as Error };
    } finally {
      this.set({ saving: false });
    }
  }
}
