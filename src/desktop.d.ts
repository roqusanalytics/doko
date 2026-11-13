type ContentDocument = MarkdownDocument | GalleryDocument | WorkbookDocument;
// `format` marks a content document that is not Markdown ("text" is a .txt file, "csv" a .csv file, "svg" an .svg file shown as an image with its XML as the source; "html" is a read-only HTML preview; absent means Markdown).
// `encoding` is the label of the file's encoding on desktop (for example "UTF-8" or "Windows-1257").
interface MarkdownDocument { kind: "markdown"; id?: string; name: string; text: string; format?: "text" | "csv" | "svg" | "html"; encoding?: string;
  // A .txt, .csv or .svg file's original BOM and line endings (rows, and for CSV also breaks inside quoted cells); each is absent when
  // it is the default (no BOM, "\n"). The editor text always uses "\n"; saving or exporting a copy restores them.
  bom?: boolean; eol?: string; cellEol?: string }
// A read-only Excel workbook (desktop only): each worksheet as plain display text. Rows are ragged: a row ends at its last
// value and an empty row is []. `truncated` marks a sheet, or the workbook, that was too large to read completely.
interface WorkbookDocument { kind: "workbook"; id?: string; name: string; sheets: { name: string; rows: string[][]; truncated: boolean }[]; truncated: boolean }
interface GalleryDocument { kind: "gallery"; id?: string; name: string; files: string[]; selected: string; blobs?: Record<string, Blob> }
type ContentSaveResult = { ok?: boolean; document?: MarkdownDocument; cancelled?: boolean; conflict?: boolean; unencodable?: boolean; error?: string };

interface UpdateStatus {
  state: "idle" | "unsupported" | "checking" | "latest" | "available" | "downloading" | "ready" | "error";
  version?: string;
  percent?: number;
  message?: string;
  checkedAt?: number;
  /** Plain-text release notes of the offered update. */
  notes?: string;
}

// Present only when Doko runs as the desktop app (see electron/preload.cjs).
type FileCommand = "save" | "save-as" | "export" | "compress" | "print" | "properties" | "recent" | "hand";
type FileSaveFormat = "pdf" | "png" | "jpg" | "webp" | "html" | "txt" | "csv" | "svg" | "md" | "zip" | "json";
type FileSaveResult = { ok?: boolean; cancelled?: boolean; id?: string; name?: string; error?: string; conflict?: boolean };
interface FolioDesktop {
  saveFile(request: { name: string; data: Uint8Array; format: FileSaveFormat; id?: string; saveAs?: boolean }): Promise<FileSaveResult>;
  setFileMenu(state: { kind: "none" | "pdf" | "photo" | "markdown" | "workbook" | "html"; busy: boolean }): void;
  onFileCommand(callback: (command: FileCommand) => void): () => void;
  content: {
    open(file: File): Promise<ContentDocument>;
    /** `token` is set when the tab was already open as "Opening…" (see onConverting). */
    onOpen(callback: (document: ContentDocument, token?: string) => void): () => void;
    save(id: string, text: string, copy?: boolean, utf8?: boolean): Promise<ContentSaveResult>;
    reload(id: string): Promise<MarkdownDocument>;
    refresh(id: string, selected: string): Promise<GalleryDocument>;
    image(id: string, name: string): Promise<{ data: Uint8Array; mime: string }>;
    asset(id: string, relative: string): Promise<{ data: Uint8Array; mime: string }>;
    trash(id: string, name: string): Promise<GalleryDocument | null>;
    reveal(id: string, name?: string): Promise<boolean>;
    release(id: string): Promise<void>;
  };
  getPrinters(): Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
  printSheets(job: { images: string[]; paper: "Letter" | "A4" | "Legal"; landscape: boolean; dpi: 150 | 300 | 600;
    copies: number; printer: string; booklet: boolean }): Promise<{ ok: boolean; error?: string }>;
  /** `note` says where a converted Word document's PDF was saved. */
  onOpenFile(callback: (name: string, data: Uint8Array, note?: string, token?: string) => void): () => void;
  onConverting(callback: (name: string, token: string) => void): () => void;
  onOpenFailed(callback: (message: string, token: string) => void): () => void;
  onTabCommand(callback: (command: "new" | "close" | "next" | "previous") => void): () => void;
  openDocument(file: File): Promise<{ name: string; data: Uint8Array; note?: string }>;
  ready(): Promise<boolean>;
  /** Null when the user declines to open an address on their computer or local network, or the request is stopped. */
  fetchPdf(url: string, id: string): Promise<{ name: string; data: Uint8Array } | null>;
  /** Stops the fetchPdf request that was started with this id (it then resolves to null). */
  cancelFetchPdf(id: string): Promise<boolean>;
  getAppInfo(): Promise<{ version: string; mode: "development" | "portable" | "installed" | "appimage" | "package"; location: string; platform: string;
    /** True when updates are announced with a download link instead of installed (unsigned macOS builds). */
    notifyOnly: boolean }>;
  /** "win32", "darwin", or "linux". */
  platform: string;
  /** Opens the releases page (macOS, where updates are downloaded manually). */
  openDownload(): Promise<void>;
  downloadOcrModel(code: string): Promise<Uint8Array<ArrayBuffer>>;
  openInstallation(): Promise<string>;
  setTheme(theme: string): void;
  /** Returns whether a native translucent material is active; accessibility preferences take priority. */
  setWindowTransparency(enabled: boolean): Promise<boolean>;
  onWindowTransparency(callback: (enabled: boolean) => void): () => void;
  onCloseCancelled(callback: () => void): () => void;
  onPrepareClose(callback: () => Promise<boolean>): () => void;
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  checkForUpdates(): void;
  getAutoUpdateEnabled(): Promise<boolean>;
  setAutoUpdateEnabled(enabled: boolean): Promise<boolean>;
  ai: FolioAi;
}

interface AiStatus {
  openrouter: { configured: boolean };
  chatgpt: { connected: boolean; email: string; name: string; welcomeSeen: boolean; encrypted: boolean };
  claude: { installed: boolean; loggedIn: boolean; version?: string; subscription?: boolean; authMethod?: string };
}

interface AiMessage {
  role: "user" | "assistant";
  content: string;
  context?: { text: string; page: number };
}

interface AiEvent {
  id: string;
  type: "delta" | "done" | "error";
  text?: string;
  message?: string;
  code?: string;
  link?: string;
}

interface FolioAi {
  status(): Promise<AiStatus>;
  signInChatGPT(): Promise<{ ok: boolean; status?: AiStatus["chatgpt"]; error?: string }>;
  signOutChatGPT(): Promise<AiStatus["chatgpt"]>;
  chatgptWelcomeSeen(): Promise<boolean>;
  chatgptModels(): Promise<{ ok: boolean; models?: { id: string; name: string }[]; error?: string; code?: string }>;
  recheckClaude(): Promise<AiStatus["claude"]>;
  openRouterKey(action: "save" | "check" | "remove", key?: string): Promise<{ ok: boolean; configured?: boolean; error?: string }>;
  openRouterModels(): Promise<{ ok: boolean; models?: OpenRouterModel[]; error?: string }>;
  ask(request: { id: string; provider: "chatgpt" | "claude" | "openrouter"; model: string; document: { name: string; text: string; truncated: boolean };
    messages: AiMessage[] }): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  onEvent(callback: (event: AiEvent) => void): () => void;
}

interface OpenRouterModel { id: string; name: string; contextLength: number | null; created: number | null }

interface Window {
  folioDesktop?: FolioDesktop;
}
