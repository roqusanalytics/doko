import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Excalidraw, FONT_FAMILY, MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
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

  useEffect(() => {
    // This scene lives in the reader until its tab closes. Keep the frame mounted when switching tabs.
    const reader: Reader = { open() {}, flush: async () => {} };
    tabs.bind(tabKey, reader);
  }, [tabs, tabKey]);
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
    </header>
    <DocumentTabBar tabs={tabs} tabKey={tabKey} />
    <main className="canvas-document-stage" id="reader-panel" role="tabpanel" aria-labelledby="selected-document-tab">
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
    </main>
  </div>;
}
