import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { IPC_PREFIX, isCanvasDocumentFile, localSources } from "../content-source";
import type { ReaderContext } from "../documentTabs";
import { getCanvasDocumentDraft, writeCanvasDocumentDraft } from "../recent";
import { canvasDocumentAppState, loadCanvasDocument, serializeCanvasDocument } from "./canvasDocumentScene";

const AUTO_SAVE_DELAY = 750;
const DRAFT_WRITE_ERROR = "Couldn't keep this draft on this device. Save the drawing to a file to keep your changes.";

export function useCanvasDocumentFile(tabs: ReaderContext["tabs"], tabKey: number, initial: CanvasDocument,
  editor: RefObject<ExcalidrawImperativeAPI | null>, onFlush: () => Promise<void>) {
  const flushExtra = useRef(onFlush);
  flushExtra.current = onFlush;
  const [document, setDocument] = useState(initial);

  const [initialScene, setInitialScene] = useState(() => {
    if (initial.draftId) return null;

    try { return loadCanvasDocument(initial.text); }
    catch { return null; }
  });

  const [error, setError] = useState(initialScene || initial.draftId ? "" : "Couldn't open this Excalidraw drawing. Its scene data is invalid.");
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const closePrompt = useRef<{ promise: Promise<boolean>; resolve: (answer: boolean) => void } | null>(null);

  const current = useRef({
    document: initial, saved: "", timer: 0, pending: null as Promise<boolean> | null,
    revision: 0, savedRevision: 0, changeKey: "", files: undefined as ReturnType<ExcalidrawImperativeAPI["getFiles"]> | undefined,
    draftId: initial.draftId, draftRevision: 0, draftTimer: 0, discarding: false,
    draftWrite: null as Promise<boolean> | null, loadingDraft: null as Promise<void> | null,
  }).current;

  function persistDraft(): Promise<boolean> {
    if (current.draftWrite) return current.draftWrite;

    if (!current.draftId || current.document.id || current.revision === current.draftRevision) return Promise.resolve(true);
    const api = editor.current;

    if (!api || api.getAppState().isLoading) return Promise.resolve(false);
    const id = current.draftId, revision = current.revision;

    const operation = (async () => {
      try {
        await writeCanvasDocumentDraft(id, serializeCanvasDocument(api));
        current.draftRevision = revision;
        setError(error => error === DRAFT_WRITE_ERROR ? "" : error);

        return true;
      } catch {
        if (!current.document.id) setError(DRAFT_WRITE_ERROR);

        return false;
      }
    })();

    current.draftWrite = operation;
    void operation.then(ok => {
      current.draftWrite = null;

      if (ok && current.revision !== revision) scheduleDraft();
    });

    return operation;
  }

  function scheduleDraft() {
    if (current.draftTimer || current.document.id || current.discarding) return;
    // Coalesce frequent edits without deferring a checkpoint for the duration of a long drawing gesture.
    current.draftTimer = window.setTimeout(() => {
      current.draftTimer = 0;
      void persistDraft();
    }, AUTO_SAVE_DELAY);
  }

  async function removeDraft() {
    window.clearTimeout(current.draftTimer);
    current.draftTimer = 0;

    if (!current.draftId) return true;
    // Let any earlier write commit before deleting the draft so it can't reappear.
    await current.draftWrite;

    try {
      await writeCanvasDocumentDraft(current.draftId);

      if (current.document.id) current.draftId = undefined;
      else current.savedRevision = current.draftRevision = current.revision;

      return true;
    } catch {
      setError(current.document.id ? "Drawing saved, but the local draft couldn't be removed."
        : "Couldn't discard the local draft. Your drawing is still open.");

      return false;
    }
  }

  const save = (copy = false, ifChanged = false): Promise<boolean> => {
    if (current.pending) return current.pending;
    const desktop = window.folioDesktop, api = editor.current;

    if (!desktop || !api || api.getAppState().isLoading || current.discarding) return Promise.resolve(false);
    window.clearTimeout(current.timer);
    const text = serializeCanvasDocument(api), revision = current.revision;

    const markSaved = () => {
      current.saved = text;
      current.savedRevision = revision;
      tabs.markDirty(tabKey, revision !== current.revision);
    };

    setError("");

    if (ifChanged && text === current.saved) {
      markSaved();

      return Promise.resolve(true);
    }

    setSaving(true);

    const operation = (async () => {
      try {
        const result = await desktop.content.saveCanvasDocument(current.document.id, text, copy);

        if (result.cancelled) return false;

        if (!result.ok || !result.document) {
          setError(result.error || (result.conflict ? "This file changed outside Doko. Use Save As to keep your changes." : "Couldn't save this drawing."));

          return false;
        }

        current.document = result.document;
        await removeDraft();
        tabs.contentSaved(tabKey, result.document);
        setDocument(result.document);
        markSaved();

        return true;
      } catch (error) {
        setError(error instanceof Error ? error.message.replace(IPC_PREFIX, "") : "Couldn't save this drawing.");

        return false;
      } finally { setSaving(false); }
    })();

    current.pending = operation;
    void operation.then(() => {
      current.pending = null;

      if (current.document.id && current.revision !== revision) scheduleSave();
    });

    return operation;
  };

  function scheduleSave() {
    window.clearTimeout(current.timer);
    current.timer = window.setTimeout(() => { void save(false, true); }, AUTO_SAVE_DELAY);
  }

  const onChange: NonNullable<ExcalidrawProps["onChange"]> = (elements, state, files) => {
    if (state.isLoading || !editor.current || current.discarding) return;

    // Ignore theme, zoom and selection changes without serializing image data on every update.
    const changeKey = JSON.stringify([canvasDocumentAppState(state), elements.filter(element => !element.isDeleted)
      .map(element => [element.id, element.version, element.versionNonce])]);

    if (current.changeKey === changeKey && current.files === files) return;

    if (!current.changeKey) {
      if (current.document.id) current.saved = serializeCanvasDocument(editor.current);
    } else if (current.document.id || current.draftId) {
      current.revision++;
      tabs.markDirty(tabKey, true);

      if (current.document.id) scheduleSave();
      else scheduleDraft();
    }

    current.changeKey = changeKey;
    current.files = files;
  };

  const finishSaving = async () => {
    if (current.pending) await current.pending;

    while (current.document.id && current.revision !== current.savedRevision) {
      if (!await save(false, true)) return false;
    }

    if (current.document.id && current.draftId && !await removeDraft()) return false;

    return true;
  };

  const flush = async () => {
    await flushExtra.current();
    await current.loadingDraft;

    if (!await finishSaving()) throw new Error("Couldn't finish saving this drawing.");

    while (current.draftId && !current.document.id && current.draftRevision !== current.revision) {
      if (!await persistDraft()) throw new Error("Couldn't keep this Canvas draft.");
    }
  };

  const canClose = async () => {
    await current.loadingDraft;

    if (!await finishSaving()) return false;

    if (current.document.id || current.revision === current.savedRevision) return true;

    if (!closePrompt.current) {
      let resolve!: (answer: boolean) => void;
      const promise = new Promise<boolean>(answer => { resolve = answer; });
      closePrompt.current = { promise, resolve };
      setConfirmClose(true);
    }

    return closePrompt.current.promise;
  };

  const answerClose = async (action: "save" | "discard" | "cancel") => {
    if (current.pending || current.discarding) return;

    if (action === "save" && (!await save() || !await finishSaving())) return;

    if (action === "discard") {
      current.discarding = true;
      setSaving(true);
      const removed = await removeDraft();
      current.discarding = false;
      setSaving(false);

      if (!removed) return;
      tabs.markDirty(tabKey, false);
    }

    setConfirmClose(false);
    closePrompt.current?.resolve(action !== "cancel");
    closePrompt.current = null;
  };

  useEffect(() => {
    let disposed = false;

    if (initial.draftId) {
      current.loadingDraft = getCanvasDocumentDraft(initial.draftId).then(text => {
        if (disposed) return;
        setInitialScene(loadCanvasDocument(text));
        current.revision = current.draftRevision = text === undefined ? 0 : 1;
        tabs.markDirty(tabKey, text !== undefined);
      }).catch(() => {
        if (disposed) return;
        current.revision = current.draftRevision = 1;
        tabs.markDirty(tabKey, true);
        setError("Couldn't open this local Canvas draft.");
      });
    }

    tabs.bind(tabKey, {
      open() {},
      canClose,
      flush,
      canSuspendDirty: true,
      suspend: async () => {
        if (closePrompt.current || (!current.document.id && !current.draftId)) return;
        await flush();
        const document = current.document;

        return { kind: "content", name: document.name, document };
      },
    });

    return () => {
      disposed = true;
      window.clearTimeout(current.timer);
      window.clearTimeout(current.draftTimer);
      closePrompt.current?.resolve(false);
    };
  }, [tabs, tabKey]);

  const onDrop = (event: DragEvent) => {
    const files = Array.from(event.dataTransfer.files).filter(isCanvasDocumentFile);

    if (!files.length) return;
    // The editor also accepts drops. Open a Doko tab instead of replacing its current scene.
    event.preventDefault();
    event.stopPropagation();
    void localSources(files).then(sources => tabs.open(sources));
  };

  return { document, initialScene, error, saving, save, onChange, onDrop, confirmClose, answerClose };
}
