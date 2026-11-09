// Capture either a native atomic save or a browser download in the test's temporary folder.
export async function captureSave(app, file, key = 'folioSaved') {
  await app.evaluate(({ dialog, session }, { file, key }) => {
    const fs = process.mainModule.require('node:fs');
    globalThis.folioSaveCaptureCleanup?.();
    const original = dialog.showSaveDialog;
    const choose = async () => ({ canceled: false, filePath: file });
    dialog.showSaveDialog = choose;
    globalThis[key] = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        fs.unwatchFile(file, changed);
        session.defaultSession.removeListener('will-download', download);
        if (dialog.showSaveDialog === choose) dialog.showSaveDialog = original;
        if (globalThis.folioSaveCaptureCleanup === cleanup) delete globalThis.folioSaveCaptureCleanup;
      };
      const finish = state => { cleanup(); resolve(state); };
      const changed = (current, previous) => {
        if (current.isFile() && current.size > 0 && (current.ino !== previous.ino || current.ctimeMs !== previous.ctimeMs)) finish('completed');
      };
      const download = (_event, item) => {
        item.setSavePath(file);
        item.once('done', (_event, state) => finish(state));
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Save was not captured: ${file}`)); }, 30_000);
      fs.watchFile(file, { interval: 25, persistent: false }, changed);
      session.defaultSession.once('will-download', download);
      globalThis.folioSaveCaptureCleanup = cleanup;
    });
  }, { file, key });
}
