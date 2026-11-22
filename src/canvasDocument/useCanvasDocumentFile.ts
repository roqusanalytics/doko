import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { IPC_PREFIX, isCanvasDocumentFile, localSources } from "../content-source";
import type { ReaderContext } from "../documentTabs";
import { canvasDocumentAppState, loadCanvasDocument, serializeCanvasDocument } from "./canvasDocumentScene";

const AUTO_SAVE_DELAY = 750;

export function useCanvasDocumentFile(tabs: ReaderContext["tabs"], tabKey: number, initial: CanvasDocument,
  editor: RefObject<ExcalidrawImperativeAPI | null>) {
  const [document, setDocument] = useState(initial);
  const [initialScene] = useState(() => {
    try { return loadCanvasDocument(initial.text); }
    catch { return null; }
  });
  const [error, setError] = useState(initialScene ? "" : "Couldn't open this Excalidraw drawing. Its scene data is invalid.");
  const [saving, setSaving] = useState(false);
  const current = useRef({
    document: initial, saved: "", timer: 0, pending: null as Promise<boolean> | null,
    revision: 0, savedRevision: 0, changeKey: "", files: undefined as ReturnType<ExcalidrawImperativeAPI["getFiles"]> | undefined,
  }).current;

  const save = (copy = false, ifChanged = false): Promise<boolean> => {
    if (current.pending) return current.pending;
    const desktop = window.folioDesktop, api = editor.current;
    if (!desktop || !api || api.getAppState().isLoading) return Promise.resolve(false);
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
    // Ignore theme, zoom and selection changes without serializing image data on every update.
    const changeKey = JSON.stringify([canvasDocumentAppState(state), elements.filter(element => !element.isDeleted)
      .map(element => [element.id, element.version, element.versionNonce])]);
    if (current.changeKey === changeKey && current.files === files) return;
    if (!current.changeKey && current.document.id) current.saved = serializeCanvasDocument(editor.current!);
    else {
      current.revision++;
      if (current.document.id) {
        tabs.markDirty(tabKey, true);
        scheduleSave();
      }
    }
    current.changeKey = changeKey;
    current.files = files;
  };

  const finishSaving = async () => {
    if (current.pending) await current.pending;
    while (current.document.id && current.revision !== current.savedRevision) {
      if (!await save(false, true)) return false;
    }
    return true;
  };
  useEffect(() => {
    tabs.bind(tabKey, {
      open() {},
      canClose: finishSaving,
      flush: async () => {
        if (!await finishSaving()) throw new Error("Couldn't finish saving this drawing.");
      },
    });
    return () => window.clearTimeout(current.timer);
  }, [tabs, tabKey]);

  const onDrop = (event: DragEvent) => {
    const files = Array.from(event.dataTransfer.files).filter(isCanvasDocumentFile);
    if (!files.length) return;
    // The editor also accepts drops. Open a Doko tab instead of replacing its current scene.
    event.preventDefault();
    event.stopPropagation();
    void localSources(files).then(sources => tabs.open(sources));
  };

  return { document, initialScene, error, saving, save, onChange, onDrop };
}
