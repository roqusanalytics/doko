// Minimal bridge between the Doko page and the desktop shell.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

/**
 * Listens to a main-process event until the returned function is called. `args` turns the event's arguments into
 * the callback's. Each channel is still named here, so this file stays the allowlist of what the page can reach.
 * @param {string} channel
 * @param {(...values: any[]) => any[]} [args]
 */
const subscribe = (channel, args = value => [value]) => callback => {
  const listener = (_event, ...values) => callback(...args(...values));
  ipcRenderer.on(channel, listener);

  return () => ipcRenderer.removeListener(channel, listener);
};

// Typed against src/desktop.d.ts: `bun run build` fails when the two disagree (tsconfig.preload.json).
/** @type {FolioDesktop} */
const folioDesktop = {
  openFiles: type => ipcRenderer.invoke("folio:open-files", type),
  saveFile: request => ipcRenderer.invoke("folio:save-file", request),
  captureDesktop: () => ipcRenderer.invoke("folio:capture-desktop").then(png => png ? new Uint8Array(png) : null),
  cancelScreenshot: () => ipcRenderer.invoke("folio:screenshot-cancel"),
  setFileMenu: state => ipcRenderer.send("folio:file-menu", state),
  onFileCommand: subscribe("folio:file-command"),
  getPrinters: () => ipcRenderer.invoke("folio:printers"),
  printSheets: (job) => ipcRenderer.invoke("folio:print-sheets", job),
  /** Called with (name, data, note?) whenever a PDF is opened from Explorer, or a Word document has been converted. */
  onOpenFile: subscribe("folio:open-file", file => [file.name, new Uint8Array(file.data), file.note ?? undefined, file.token]),
  /** Called with the file name when a Word document starts converting, and with a message if it fails. */
  onConverting: subscribe("folio:converting", file => [file.name, file.token]),
  onOpenFailed: subscribe("folio:open-failed", failure => [failure.message, failure.token]),
  onTabCommand: subscribe("folio:tab-command"),
  /** Returns the converted PDF to the tab that opened the Word document. */
  openDocument: (file) => ipcRenderer.invoke("folio:open-document", webUtils.getPathForFile(file)),
  content: {
    open: file => ipcRenderer.invoke("folio:content-open", webUtils.getPathForFile(file)),
    onOpen: subscribe("folio:open-content", (document, token) => [document, token]),
    save: (id, text, copy = false, utf8 = false) => ipcRenderer.invoke("folio:content-save", id, text, copy, utf8),
    saveCanvasDocument: (id, text, copy = false) => ipcRenderer.invoke("folio:content-save-canvas-document", id, text, copy),
    reload: id => ipcRenderer.invoke("folio:content-reload", id),
    refresh: (id, selected) => ipcRenderer.invoke("folio:content-refresh", id, selected),
    async image(id, name) {
      const result = await ipcRenderer.invoke("folio:content-image", id, name);

      return { data: new Uint8Array(result.data), mime: result.mime };
    },
    async asset(id, relative) {
      const result = await ipcRenderer.invoke("folio:content-asset", id, relative);

      return { data: new Uint8Array(result.data), mime: result.mime };
    },
    async trash(id, name) {
      const result = await ipcRenderer.invoke("folio:content-trash", id, name);

      if (result.error) throw new Error(result.error);

      return result.gallery;
    },
    reveal: (id, name) => ipcRenderer.invoke("folio:content-reveal", id, name),
    release: id => ipcRenderer.invoke("folio:content-release", id),
  },
  ready: () => ipcRenderer.invoke("folio:ready"),
  platform: process.platform,
  openDownload: () => ipcRenderer.invoke("folio:open-download"),
  downloadOcrModel: (code) => ipcRenderer.invoke("folio:download-ocr-model", code),
  /**
   * Downloads a PDF from an http(s) link; resolves to { name, data: Uint8Array }, or null if the user said no
   * or the request was stopped with cancelFetchPdf(id).
   */
  async fetchPdf(url, id) {
    const file = await ipcRenderer.invoke("folio:fetch-pdf", url, id);

    if (file.cancelled) return null;

    if (file.error) throw new Error(file.error);

    return { name: file.name, data: new Uint8Array(file.data) };
  },
  cancelFetchPdf: (id) => ipcRenderer.invoke("folio:cancel-fetch-pdf", id),
  getAppInfo: () => ipcRenderer.invoke("folio:app-info"),
  openInstallation: () => ipcRenderer.invoke("folio:open-installation"),
  setTheme: (theme) => ipcRenderer.send("folio:theme", theme),
  setWindowTransparency: enabled => ipcRenderer.invoke("folio:set-window-transparency", enabled),
  onWindowTransparency: subscribe("folio:window-transparency"),
  onCloseCancelled: subscribe("folio:close-cancelled", () => []),
  onPrepareClose: callback => subscribe("folio:prepare-close")(id => {
    Promise.resolve().then(callback).then(ready => {
      ipcRenderer.send("folio:prepared-close", id, ready ? "ready" : "cancelled");
    }, () => ipcRenderer.send("folio:prepared-close", id, "error"));
  }),
  installUpdate: () => ipcRenderer.send("folio:install-update"),
  /** Called with the updater state ({ state, version?, percent?, message? }) now and whenever it changes. */
  onUpdateStatus(callback) {
    const stop = subscribe("folio:update-status-changed")(callback);
    ipcRenderer.invoke("folio:update-state").then(callback);

    return stop;
  },
  checkForUpdates: () => ipcRenderer.send("folio:check-update"),
  getAutoUpdateEnabled: () => ipcRenderer.invoke("folio:auto-update-setting"),
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke("folio:set-auto-update-setting", enabled),
  ai: {
    status: () => ipcRenderer.invoke("folio:ai-status"),
    signInChatGPT: () => ipcRenderer.invoke("folio:ai-chatgpt-signin"),
    signOutChatGPT: () => ipcRenderer.invoke("folio:ai-chatgpt-signout"),
    chatgptWelcomeSeen: () => ipcRenderer.invoke("folio:ai-chatgpt-welcome-seen"),
    chatgptModels: () => ipcRenderer.invoke("folio:ai-chatgpt-models"),
    recheckClaude: () => ipcRenderer.invoke("folio:ai-claude-recheck"),
    openRouterKey: (action, key) => ipcRenderer.invoke("folio:ai-router-key", action, key),
    openRouterModels: () => ipcRenderer.invoke("folio:ai-router-models"),
    ask: (request) => ipcRenderer.invoke("folio:ai-ask", request),
    cancel: (id) => ipcRenderer.invoke("folio:ai-cancel", id),
    /** Called with { id, type: "delta" | "done" | "error", text?, message?, code?, link? } for every answer. */
    onEvent: subscribe("folio:ai-event"),
  },
};

contextBridge.exposeInMainWorld("folioDesktop", folioDesktop);
