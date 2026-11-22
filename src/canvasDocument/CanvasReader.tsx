import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { AiPanel, flushAiHistory, forgetClearedChats, stopAiForClose } from "../AiPanel";
import { Modal } from "../Dialogs";
import { SettingsDialog } from "../SettingsDialog";
import { onStoredDataCleared } from "../recent";
import { summarizeScene } from "./canvasDocumentSceneSummary";
import { insertCanvasDocumentDrawing } from "./insertCanvasDocumentDrawing";
import { DocumentTabBar } from "../DocumentTabBar";
import type { ReaderContext } from "../documentTabs";
import { useFileCommands } from "../fileCommands";
import { Icon } from "../icons";
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
  const [properties, setProperties] = useState(false);
  const [exportSnapshot, setExportSnapshot] = useState<CanvasExportSnapshot | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  const [aiOpen, setAiOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [chatId] = useState(() => `canvas:${initial.id ?? initial.draftId ?? crypto.randomUUID()}`);
  const [chatGeneration, setChatGeneration] = useState(0);
  const flushAi = useCallback(async () => { stopAiForClose(chatId); await flushAiHistory(chatId); }, [chatId]);
  const file = useCanvasDocumentFile(tabs, tabKey, initial, editor, flushAi);
  useEffect(() => onStoredDataCleared((category, generation) => {
    if (category !== "ai") return;
    forgetClearedChats(generation);
    setChatGeneration(current => Math.max(current, generation));
  }), []);
  const readScene = useCallback(async () => {
    if (!editor.current) throw new Error("The drawing editor is still loading.");
    return summarizeScene(editor.current.getSceneElements(), editor.current.getAppState().selectedElementIds);
  }, []);
  const insertDrawing = useCallback((reply: string) => {
    if (!editor.current) throw new Error("The drawing editor is still loading.");
    return insertCanvasDocumentDrawing(editor.current, reply);
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
  useEffect(() => {
    if (!active || properties || exportSnapshot || file.confirmClose || !window.folioDesktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void file.save(event.shiftKey);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, properties, exportSnapshot, file.confirmClose, file.save]);
  useFileCommands(active, "canvas", file.saving || file.confirmClose || properties || !!exportSnapshot, command => {
    if (command === "recent") tabs.library();
    else if (command === "save" || command === "save-as") void file.save(command === "save-as");
    else if (command === "properties") setProperties(true);
    else if (command === "export" && editor.current) setExportSnapshot(captureCanvasExport(editor.current, file.document.name));
  });

  return <div className="app canvas-document-reader" onDropCapture={file.onDrop}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}>
    <header ref={header} className="topbar">
      <div className="topbar-left">
        <button className="brand" title="Back to library" onClick={() => tabs.library()}>
          <span className="brand-mark" /><span className="brand-name">Doko</span>
        </button>
        <div className="doc-title"><span>{file.document.name}</span></div>
      </div>
      {window.folioDesktop?.ai && <div className="topbar-right">
        <button className={`icon-btn ${aiOpen ? "on" : ""}`} type="button" onClick={() => setAiOpen(!aiOpen)}
          title="Ask AI" aria-label="Ask AI" aria-pressed={aiOpen}><Icon name="sparkle" /></button>
      </div>}
    </header>
    <DocumentTabBar tabs={tabs} tabKey={tabKey} />
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
    <main className="canvas-document-workspace" id="reader-panel" role="tabpanel" aria-labelledby="selected-document-tab" inert={!!exportSnapshot || file.confirmClose}>
      <div className="canvas-document-stage">
        {file.initialScene && <Excalidraw theme={theme} initialData={file.initialScene} onChange={file.onChange} UIOptions={canvasDocumentUi}
          aiEnabled={false} validateEmbeddable={false} showDeprecatedFonts
          excalidrawAPI={api => { editor.current = api; }}>
          <MainMenu>
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.Item icon={<Icon name="book" size={16} />} onSelect={() => {
              editor.current?.toggleSidebar({ name: "default", tab: "library" });
            }}>Library</MainMenu.Item>
          </MainMenu>
        </Excalidraw>}
      </div>
      {active && aiOpen && <AiPanel key={chatGeneration}
        documentContext={{ kind: "canvas", name: file.document.name, displayName: file.document.name, selection: null, readText: readScene }}
        docId={chatId} persist onDrawingReply={insertDrawing} onClose={() => setAiOpen(false)} onSettings={() => setAiSettings(true)} />}
    </main>
    {exportSnapshot && <DocumentExportDialog snapshot={exportSnapshot} mode="export" onClose={() => setExportSnapshot(null)} onSave={saveCanvasExport} />}
    {active && aiSettings && <SettingsDialog initialSection="Ask AI" onClose={() => setAiSettings(false)} />}
  </div>;
}
