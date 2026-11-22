import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Modal } from "../Dialogs";
import { DocumentTabBar } from "../DocumentTabBar";
import type { ReaderContext } from "../documentTabs";
import { useFileCommands } from "../fileCommands";
import { Icon } from "../icons";
import { trackTitlebar } from "../titlebar";
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
  const file = useCanvasDocumentFile(tabs, tabKey, initial, editor);
  const [properties, setProperties] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");

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
    if (!active || properties || !window.folioDesktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void file.save(event.shiftKey);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, properties, file.save]);
  useFileCommands(active, "canvas", file.saving || properties, command => {
    if (command === "recent") tabs.library();
    else if (command === "save" || command === "save-as") void file.save(command === "save-as");
    else if (command === "properties") setProperties(true);
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
    <main className="canvas-document-stage" id="reader-panel" role="tabpanel" aria-labelledby="selected-document-tab">
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
    </main>
  </div>;
}
