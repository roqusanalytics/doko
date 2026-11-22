import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Excalidraw, FONT_FAMILY, MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { AiPanel, flushAiHistory, forgetClearedChats, stopAiForClose } from "../AiPanel";
import { SettingsDialog } from "../SettingsDialog";
import { onStoredDataCleared } from "../recent";
import { summarizeScene } from "./canvasDocumentSceneSummary";
import { insertCanvasDocumentDrawing } from "./insertCanvasDocumentDrawing";
import { DocumentTabBar } from "../DocumentTabBar";
import type { Reader, ReaderContext } from "../documentTabs";
import { useFileCommands } from "../fileCommands";
import { Icon } from "../icons";
import { trackTitlebar } from "../titlebar";
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
const initialScene = { appState: { currentItemFontFamily: FONT_FAMILY.Virgil } };

export default function CanvasReader({ tabs, tabKey, initial }: {
  tabs: ReaderContext["tabs"]; tabKey: number; initial: CanvasDocument;
}) {
  const active = useSyncExternalStore(tabs.subscribe, () => tabs.active === tabKey);
  const header = useRef<HTMLElement>(null);
  const editor = useRef<ExcalidrawImperativeAPI>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  const [aiOpen, setAiOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [chatId] = useState(() => `canvas:${initial.id ?? crypto.randomUUID()}`);
  const [chatGeneration, setChatGeneration] = useState(0);
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

  useEffect(() => {
    // This scene lives in the reader until its tab closes. Keep the frame mounted when switching tabs.
    const reader: Reader = { open() {}, flush: async () => { stopAiForClose(chatId); await flushAiHistory(chatId); } };
    tabs.bind(tabKey, reader);
  }, [tabs, tabKey, chatId]);
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
  useFileCommands(active, "canvas", false, command => {
    if (command === "recent") tabs.library();
  });

  return <div className="app canvas-document-reader">
    <header ref={header} className="topbar">
      <div className="topbar-left">
        <button className="brand" title="Back to library" onClick={() => tabs.library()}>
          <span className="brand-mark" /><span className="brand-name">Doko</span>
        </button>
        <div className="doc-title"><span>{initial.name}</span></div>
      </div>
      {window.folioDesktop?.ai && <div className="topbar-right">
        <button className={`icon-btn ${aiOpen ? "on" : ""}`} type="button" onClick={() => setAiOpen(!aiOpen)}
          title="Ask AI" aria-label="Ask AI" aria-pressed={aiOpen}><Icon name="sparkle" /></button>
      </div>}
    </header>
    <DocumentTabBar tabs={tabs} tabKey={tabKey} />
    <main className="canvas-document-workspace" id="reader-panel" role="tabpanel" aria-labelledby="selected-document-tab">
      <div className="canvas-document-stage">
        <Excalidraw theme={theme} initialData={initialScene} UIOptions={canvasDocumentUi}
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
        </Excalidraw>
      </div>
      {active && aiOpen && <AiPanel key={chatGeneration}
        documentContext={{ kind: "canvas", name: initial.name, displayName: initial.name, selection: null, readText: readScene }}
        docId={chatId} persist onDrawingReply={insertDrawing} onClose={() => setAiOpen(false)} onSettings={() => setAiSettings(true)} />}
    </main>
    {active && aiSettings && <SettingsDialog initialSection="Ask AI" onClose={() => setAiSettings(false)} />}
  </div>;
}
