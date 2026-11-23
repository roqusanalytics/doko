import { FONT_FAMILY, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

export function canvasDocumentAppState(state: Partial<AppState>) {
  return {
    viewBackgroundColor: typeof state.viewBackgroundColor === "string" ? state.viewBackgroundColor : undefined,
    gridSize: Number.isFinite(state.gridSize) ? state.gridSize : undefined,
    gridStep: Number.isFinite(state.gridStep) ? state.gridStep : undefined,
    gridModeEnabled: typeof state.gridModeEnabled === "boolean" ? state.gridModeEnabled
      : state.gridSize === undefined ? undefined : Number.isFinite(state.gridSize),
  };
}

export function loadCanvasDocument(text?: string): ExcalidrawInitialDataState {
  const appState = { currentItemFontFamily: FONT_FAMILY.Virgil };

  if (text === undefined) return { appState };
  const scene = JSON.parse(text) as ExcalidrawInitialDataState;

  // Resolve malformed element data before the editor's asynchronous initialization.
  return { ...restore({ elements: scene.elements, files: scene.files,
    appState: { ...canvasDocumentAppState(scene.appState ?? {}), ...appState } }, null, null, { repairBindings: true }),
    scrollToContent: true };
}

export function serializeCanvasDocument(editor: ExcalidrawImperativeAPI) {
  return serializeAsJSON(editor.getSceneElements(), canvasDocumentAppState(editor.getAppState()), editor.getFiles(), "local");
}
