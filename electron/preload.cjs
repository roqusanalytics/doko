// Minimal bridge between the Doko page and the desktop shell.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("folioDesktop", {
  saveFile: request => ipcRenderer.invoke("folio:save-file", request),
  setFileMenu: state => ipcRenderer.send("folio:file-menu", state),
  onFileCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("folio:file-command", listener);
    return () => ipcRenderer.removeListener("folio:file-command", listener);
  },
  getPrinters: () => ipcRenderer.invoke("folio:printers"),
  printSheets: (job) => ipcRenderer.invoke("folio:print-sheets", job),
  /** Called with (name, data, note?) whenever a PDF is opened from Explorer, or a Word document has been converted. */
  onOpenFile(callback) {
    const listener = (_e, file) => callback(file.name, new Uint8Array(file.data), file.note ?? undefined, file.token);
    ipcRenderer.on("folio:open-file", listener);
    return () => ipcRenderer.removeListener("folio:open-file", listener);
  },
  /** Called with the file name when a Word document starts converting, and with a message if it fails. */
  onConverting(callback) {
    const listener = (_e, file) => callback(file.name, file.token);
    ipcRenderer.on("folio:converting", listener);
    return () => ipcRenderer.removeListener("folio:converting", listener);
  },
  onOpenFailed(callback) {
    const listener = (_e, failure) => callback(failure.message, failure.token);
    ipcRenderer.on("folio:open-failed", listener);
    return () => ipcRenderer.removeListener("folio:open-failed", listener);
  },
  onTabCommand(callback) {
    const listener = (_e, command) => callback(command);
    ipcRenderer.on("folio:tab-command", listener);
    return () => ipcRenderer.removeListener("folio:tab-command", listener);
  },
  /** Returns the converted PDF to the tab that opened the Word document. */
  openDocument: (file) => ipcRenderer.invoke("folio:open-document", webUtils.getPathForFile(file)),
  content: {
    open: file => ipcRenderer.invoke("folio:content-open", webUtils.getPathForFile(file)),
    onOpen(callback) {
      const listener = (_event, document) => callback(document);
      ipcRenderer.on("folio:open-content", listener);
      return () => ipcRenderer.removeListener("folio:open-content", listener);
    },
    save: (id, text, copy = false) => ipcRenderer.invoke("folio:content-save", id, text, copy),
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
  installUpdate: () => ipcRenderer.send("folio:install-update"),
  /** Called with the updater state ({ state, version?, percent?, message? }) now and whenever it changes. */
  onUpdateStatus(callback) {
    const listener = (_e, status) => callback(status);
    ipcRenderer.on("folio:update-status-changed", listener);
    ipcRenderer.invoke("folio:update-state").then(callback);
    return () => ipcRenderer.removeListener("folio:update-status-changed", listener);
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
    onEvent(callback) {
      const listener = (_e, event) => callback(event);
      ipcRenderer.on("folio:ai-event", listener);
      return () => ipcRenderer.removeListener("folio:ai-event", listener);
    },
  },
});
