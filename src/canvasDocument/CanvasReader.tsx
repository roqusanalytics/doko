import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { CaptureUpdateAction, Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { AiPanel, flushAiHistory, stopAiForClose } from "../AiPanel";
import { Modal, OpenUrlDialog } from "../Dialogs";
import { SettingsDialog } from "../SettingsDialog";
import { summarizeScene } from "./canvasDocumentSceneSummary";
import type { PreparedDrawing } from "./canvasDocumentAiReply";
import { insertCanvasDocumentDrawing, prepareCanvasDocumentDrawing } from "./insertCanvasDocumentDrawing";
import { DocumentTabBar } from "../DocumentTabBar";
import type { ReaderContext } from "../documentTabs";
import { useFileCommands } from "../fileCommands";
import { IconButton } from "../IconButton";
import { MoreMenu } from "../MoreMenu";
import { UpdateButton } from "../UpdateButton";
import { keys } from "../platform";
import { localSources, pickReaderFiles } from "../content-source";
import { normalizeColor } from "../appearance";
import { CanvasToolGroup } from "./CanvasToolGroup";
import { trackTitlebar } from "../titlebar";
import DocumentExportDialog from "../DocumentExportDialog";
import { captureCanvasExport, saveCanvasExport, type CanvasExportSnapshot } from "./canvasDocumentExport";
import { useCanvasDocumentFile } from "./useCanvasDocumentFile";
import "@excalidraw/excalidraw/index.css";
import "./canvas-reader.css";

const canvasDocumentUi = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    saveAsImage: false,
    toggleTheme: false,
  },
} as const;
export default function CanvasReader({ tabs, tabKey, initial }: {
  tabs: ReaderContext["tabs"]; tabKey: number; initial: CanvasDocument;
}) {
  const active = useSyncExternalStore(tabs.subscribe, () => tabs.active === tabKey);
  const header = useRef<HTMLElement>(null);
  const editor = useRef<ExcalidrawImperativeAPI>(null);
  const stage = useRef<HTMLDivElement>(null);
  const commands = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Pick<AppState["activeTool"], "type" | "locked">>({ type: "selection", locked: false });
  const [sidebar, setSidebar] = useState<string>();
  const [focus, setFocus] = useState(false);
  const [openUrl, setOpenUrl] = useState(false);
  const [openError, setOpenError] = useState("");
  const [background, setBackground] = useState<string | null>(null);
  const registerEditor = useCallback((api: ExcalidrawImperativeAPI) => { editor.current = api; setReady(true); }, []);
  const focusEditor = () => stage.current?.querySelector<HTMLElement>(".excalidraw")?.focus({ preventScroll: true });
  const setActiveTool = (type: Exclude<AppState["activeTool"]["type"], "custom">, moveFocus: boolean) => {
    if (moveFocus) focusEditor();
    editor.current?.setActiveTool({ type });
  };
  const [properties, setProperties] = useState(false);
  const [exportSnapshot, setExportSnapshot] = useState<CanvasExportSnapshot | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  const [aiOpen, setAiOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [chatId] = useState(() => `canvasDocument:${initial.id ?? initial.draftId ?? crypto.randomUUID()}`);
  const flushAi = useCallback(async () => { stopAiForClose(chatId); await flushAiHistory(chatId); }, [chatId]);
  const file = useCanvasDocumentFile(tabs, tabKey, initial, editor, flushAi);
  const onSceneChange: NonNullable<Parameters<typeof Excalidraw>[0]["onChange"]> = (elements, state, files) => {
    if (tool.type !== state.activeTool.type || tool.locked !== state.activeTool.locked) {
      setTool({ type: state.activeTool.type, locked: state.activeTool.locked });
    }
    if (sidebar !== state.openSidebar?.tab) setSidebar(state.openSidebar?.tab);
    file.onChange(elements, state, files);
  };
  const readScene = useCallback(async () => {
    if (!editor.current) throw new Error("The drawing editor is still loading.");
    return summarizeScene(editor.current.getSceneElements(), editor.current.getAppState().selectedElementIds);
  }, []);
  const insertDrawing = useCallback(async (reply: string | PreparedDrawing, isCurrent: () => boolean, repeated = false) => {
    const target = editor.current;
    if (!target) throw new Error("The drawing editor is still loading.");
    const prepared = typeof reply === "string"
      ? await prepareCanvasDocumentDrawing(reply, target.getSceneElements(), repeated)
      : { description: "", drawing: reply };
    if (!isCurrent() || target !== editor.current) return null;
    insertCanvasDocumentDrawing(target, prepared.drawing, repeated);
    return prepared;
  }, []);

  useLayoutEffect(() => {
    if (active && window.folioDesktop && header.current) return trackTitlebar(header.current);
  }, [active]);
  useEffect(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key === "folio:theme" && (event.newValue === "light" || event.newValue === "dark")) setTheme(event.newValue);
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);
  const blocked = file.confirmClose || properties || !!exportSnapshot || openUrl || background !== null;
  useEffect(() => {
    if (!active || blocked || !window.folioDesktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void file.save(event.shiftKey);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, blocked, file.save]);
  const toggleSidebar = (tab: "library" | "search") => editor.current?.toggleSidebar({ name: "default", tab });
  const exportCanvas = () => {
    if (editor.current) setExportSnapshot(captureCanvasExport(editor.current, file.document.name));
  };
  const toggleFocus = async () => {
    const next = !focus;
    setFocus(next);
    try {
      if (next && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!next && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Keep the Canvas chrome hidden if fullscreen is unavailable.
    }
  };
  useEffect(() => {
    const onFullscreenChange = () => { if (!document.fullscreenElement) setFocus(false); };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  useEffect(() => {
    if (!active || !focus || blocked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.fullscreenElement) setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, focus, blocked]);
  useFileCommands(active, "canvasDocument", file.saving || blocked, command => {
    if (command === "recent") tabs.library();
    else if (command === "save" || command === "save-as") void file.save(command === "save-as");
    else if (command === "properties") setProperties(true);
    else if (command === "export") exportCanvas();
  });

  return <div className="app canvas-document-reader" data-focus={focus || undefined} onDropCapture={file.onDrop}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}>
    <header ref={header} className="topbar" inert={focus || blocked}>
      <div className="topbar-left">
        <button className="brand" title="Back to library" onClick={() => tabs.library()}>
          <span className="brand-mark" /><span className="brand-name">Doko</span>
        </button>
        <IconButton icon="sidebar" label="Toggle library sidebar" active={sidebar === "library"} onClick={() => toggleSidebar("library")} />
        <div className="doc-title" title={file.document.name}><span>{file.document.name}</span></div>
      </div>
      <div className="topbar-center">
        <CanvasToolGroup tool={tool} ready={ready} onTool={setActiveTool}
          onLock={() => {
            const api = editor.current;
            if (!api) return;
            if (tool.locked) api.setActiveTool({ type: "selection", locked: false });
            else api.updateScene({ appState: { activeTool: { ...api.getAppState().activeTool, locked: true } } });
          }}
          onMermaid={() => editor.current?.updateScene({ appState: { openDialog: { name: "ttd", tab: "mermaid" } } })}
          onNewCanvas={() => tabs.newCanvasDocument()}
          onPick={type => {
            setOpenError("");
            pickReaderFiles(type, files => { void localSources(Array.from(files)).then(sources => tabs.open(sources)); },
              () => setOpenError("Couldn't open the file dialog. Try again."));
          }}
          onOpenUrl={() => setOpenUrl(true)} />
      </div>
      <div className="topbar-right">
        <UpdateButton />
        {window.folioDesktop?.ai && <IconButton icon="sparkle" label="Ask AI" active={aiOpen} onClick={() => setAiOpen(!aiOpen)} />}
        <IconButton icon="search" label={keys("Search (Ctrl+F)")} active={sidebar === "search"} onClick={() => toggleSidebar("search")} />
        <MoreMenu items={[
          { kind: "action", icon: "book", label: "Library", disabled: !ready, onSelect: () => toggleSidebar("library") },
          { kind: "action", icon: "highlight", label: "Canvas background", disabled: !ready, onSelect: () => {
            const color = editor.current?.getAppState().viewBackgroundColor;
            if (color) setBackground(color);
          } },
          { kind: "action", icon: "keyboard", label: "Help / keyboard shortcuts", shortcut: "?", disabled: !ready,
            onSelect: () => editor.current?.updateScene({ appState: { openDialog: { name: "help" } } }) },
          { kind: "action", icon: "trash", label: "Reset the canvas", disabled: !ready,
            onSelect: () => commands.current?.querySelector<HTMLButtonElement>('[data-testid="clear-canvas-button"]')?.click() },
          { kind: "divider" },
          { kind: "action", icon: "download", label: "Export / Convert…", disabled: !ready, onSelect: exportCanvas },
          { kind: "action", icon: "info", label: "Properties", onSelect: () => setProperties(true) },
        ]} />
      </div>
    </header>
    {!focus && <DocumentTabBar tabs={tabs} tabKey={tabKey} onEnterFocusMode={toggleFocus} />}
    {openError && <div className="content-notice" role="alert">{openError}</div>}
    {openUrl && <OpenUrlDialog onClose={() => setOpenUrl(false)} onSubmit={url => {
      setOpenUrl(false);
      tabs.open([{ kind: "url", name: new URL(url).hostname, url }]);
    }} />}
    {background !== null && <Modal title="Canvas background" onClose={() => setBackground(null)}>
      <form className="content-dialog" onSubmit={event => {
        event.preventDefault();
        editor.current?.updateScene({ appState: { viewBackgroundColor: background }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        setBackground(null);
      }}>
        <label className="appearance-color">Background color <input type="color" value={normalizeColor(background) ?? "#ffffff"} onChange={event => setBackground(event.target.value)} /></label>
        <div className="form-actions">
          <button className="btn ghost" type="button" onClick={() => setBackground(null)}>Cancel</button>
          <button className="btn primary" type="submit">Apply</button>
        </div>
      </form>
    </Modal>}
    {file.error && <div className="content-notice" role="alert">{file.error}</div>}
    {properties && <Modal title="Properties" onClose={() => setProperties(false)}>
      <dl className="info-list">
        <div><dt>File</dt><dd>{file.document.name}</dd></div>
        <div><dt>Type</dt><dd>Excalidraw (UTF-8)</dd></div>
        <div><dt>Elements</dt><dd>{editor.current?.getSceneElements().length.toLocaleString() ?? "0"}</dd></div>
      </dl>
    </Modal>}
    {file.confirmClose && <Modal title="Save?" onClose={() => void file.answerClose("cancel")}>
      <div className="content-dialog">
        <p>Save changes to “{file.document.name}” before closing?</p>
        {file.error && <p className="form-error" role="alert">{file.error}</p>}
        <div className="form-actions">
          <button className="btn ghost" autoFocus disabled={file.saving} onClick={() => void file.answerClose("cancel")}>Cancel</button>
          <button className="btn ghost" disabled={file.saving} onClick={() => void file.answerClose("discard")}>Don't save</button>
          <button className="btn primary" disabled={file.saving || !file.initialScene || !window.folioDesktop}
            onClick={() => void file.answerClose("save")}>Save</button>
        </div>
      </div>
    </Modal>}
    <main className="canvas-document-workspace" id="reader-panel" role={focus ? undefined : "tabpanel"}
      aria-labelledby={focus ? undefined : "selected-document-tab"} inert={blocked}>
      <div className="canvas-document-stage" ref={stage}>
        {file.initialScene && <Excalidraw theme={theme} initialData={file.initialScene} onChange={onSceneChange} UIOptions={canvasDocumentUi}
          aiEnabled={false} validateEmbeddable={false} showDeprecatedFonts
          excalidrawAPI={registerEditor}
          renderTopRightUI={() => <div hidden ref={commands}>
            {/* Keep Excalidraw's confirmation and undo semantics for Reset. */}
            <MainMenu.DefaultItems.ClearCanvas />
          </div>} />}
      </div>
      {focus && <button className="exit-focus" onClick={toggleFocus} title="Exit focus mode"><kbd>Esc</kbd> to exit focus mode</button>}
      {active && aiOpen && <AiPanel
        documentContext={{ kind: "canvasDocument", name: file.document.name, displayName: file.document.name, selection: null, readText: readScene }}
        docId={chatId} persist onDrawingReply={insertDrawing} onClose={() => setAiOpen(false)} onSettings={() => setAiSettings(true)} />}
    </main>
    {exportSnapshot && <DocumentExportDialog snapshot={exportSnapshot} mode="export" onClose={() => setExportSnapshot(null)} onSave={saveCanvasExport} />}
    {active && aiSettings && <SettingsDialog initialSection="Ask AI" onClose={() => setAiSettings(false)} />}
  </div>;
}
