import { createRoot } from "react-dom/client";
import { ReaderErrorBoundary } from "./ReaderErrorBoundary";
import { initializeAppearance } from "./appearance";
import { DocumentTabs, type ReaderFrame } from "./documentTabs";
import { takeUpgradeNotes } from "./releaseNotes";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css";
import "./reading-tools.css";
import "./appearance.css";
import "./glass.css";

initializeAppearance();

const root = document.getElementById("root")!;
const reader = (window.frameElement as ReaderFrame | null)?.readerContext;
if (reader) {
  const desktop = window.parent.folioDesktop;
  if (desktop) {
    window.folioDesktop = desktop;
    document.documentElement.classList.add("desktop", `platform-${desktop.platform}`);
  }
  // No StrictMode: the pdf.js viewer binds imperatively to its container once.
  const content = reader.tabs.contentFor(reader.key);
  const frame = window.frameElement as ReaderFrame;
  const app = createRoot(root);
  frame.disposeReader = () => app.unmount();
  const renderReader = (children: React.ReactNode) => {
    if (frame.isConnected) app.render(<ReaderErrorBoundary onError={() => reader.tabs.readerFailed(reader.key)}
      onRecover={() => reader.tabs.recover(reader.key)}>{children}</ReaderErrorBoundary>);
  };
  const failedImport = () => renderReader(<FailedReaderImport />);
  // Separate imports let Vite preload each reader's own styles.
  if (content?.kind === "markdown" || content?.kind === "workbook") {
    void import("./ContentReader").then(({ default: ContentReader }) => {
      renderReader(<ContentReader tabs={reader.tabs} tabKey={reader.key} initial={content} />);
    }).catch(failedImport);
  } else {
    const upgradeNotes = desktop && reader.tabs.active === reader.key ? takeUpgradeNotes() : [];
    void import("./App").then(({ default: App }) => {
      renderReader(<App tabs={reader.tabs} tabKey={reader.key} upgradeNotes={upgradeNotes} initialGallery={content?.kind === "gallery" ? content : undefined} />);
    }).catch(failedImport);
  }
} else {
  void new DocumentTabs(root).start();
}

function FailedReaderImport(): never { throw new Error("Reader could not be loaded."); }
