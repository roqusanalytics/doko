import { createRoot } from "react-dom/client";
import { initializeAppearance } from "./appearance";
import { DocumentTabs, type ReaderFrame } from "./documentTabs";
import { takeUpgradeNotes } from "./releaseNotes";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css";
import "./reading-tools.css";
import "./appearance.css";

initializeAppearance();

const root = document.getElementById("root")!;
const reader = (window.frameElement as ReaderFrame | null)?.readerContext;
if (reader) {
  const desktop = window.parent.folioDesktop;
  if (desktop) {
    window.folioDesktop = { ...desktop, installUpdate: () => {
      if (reader.tabs.all.some(tab => tab.dirty) && !window.parent.confirm("Restart Folio and discard unsaved changes?")) return;
      desktop.installUpdate();
    } };
    document.documentElement.classList.add("desktop", `platform-${desktop.platform}`);
  }
  // No StrictMode: the pdf.js viewer binds imperatively to its container once.
  const content = reader.tabs.contentFor(reader.key);
  const frame = window.frameElement as ReaderFrame;
  const app = createRoot(root);
  frame.disposeReader = () => app.unmount();
  // Separate imports let Vite preload each reader's own styles.
  if (content?.kind === "markdown") {
    void import("./ContentReader").then(({ default: ContentReader }) => {
      if (frame.isConnected) app.render(<ContentReader tabs={reader.tabs} tabKey={reader.key} initial={content} />);
    });
  } else {
    const upgradeNotes = desktop && reader.tabs.active === reader.key ? takeUpgradeNotes() : [];
    void import("./App").then(({ default: App }) => {
      if (frame.isConnected) app.render(<App tabs={reader.tabs} tabKey={reader.key} upgradeNotes={upgradeNotes} initialGallery={content?.kind === "gallery" ? content : undefined} />);
    });
  }
} else {
  void new DocumentTabs(root).start();
}
