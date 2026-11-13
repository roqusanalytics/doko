const path = require('node:path');

function desktopBounds(displays) {
  const x = Math.min(...displays.map(d => d.bounds.x)), y = Math.min(...displays.map(d => d.bounds.y));
  return { x, y, width: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)) - x,
    height: Math.max(...displays.map(d => d.bounds.y + d.bounds.height)) - y };
}

async function captureScreens({ desktopCapturer, screen, systemPreferences, platform = process.platform }, timeout = 15000) {
  if (platform === 'darwin' && ['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'))) {
    throw new Error('Allow Doko in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen Doko and try again.');
  }
  const displays = screen.getAllDisplays();
  const permissionError = () => platform === 'darwin' && ['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'));
  const width = Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor)));
  const height = Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor)));
  let timer;
  const sources = await Promise.race([
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Screen capture timed out. Try again.')), timeout); }),
  ]).finally(() => clearTimeout(timer));
  if (permissionError()) throw new Error('Allow Doko in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen Doko and try again.');
  if (!sources.length) throw new Error('Screen capture was cancelled or unavailable. Try again and choose a screen.');
  const screens = sources.map(source => {
    const display = displays.find(d => String(d.id) === source.display_id) ?? (displays.length === 1 ? displays[0] : null);
    // PipeWire may omit display identity: fit its frozen image into a real screen, in DIP rather than image pixels.
    let bounds = display?.bounds;
    if (!bounds && sources.length === 1) {
      const viewport = screen.getPrimaryDisplay().bounds, size = source.thumbnail.getSize();
      const scale = Math.min(viewport.width / size.width, viewport.height / size.height);
      const width = Math.max(1, Math.floor(size.width * scale)), height = Math.max(1, Math.floor(size.height * scale));
      bounds = { x: viewport.x + Math.floor((viewport.width - width) / 2), y: viewport.y + Math.floor((viewport.height - height) / 2), width, height };
    }
    if (!bounds || source.thumbnail.isEmpty()) throw new Error('Could not read this screen. Check screen recording permission and try again.');
    return { bounds, scaleFactor: display?.scaleFactor ?? 1, url: source.thumbnail.toDataURL() };
  });
  const bounds = desktopBounds(screens);
  if (bounds.width > 32768 || bounds.height > 32768) throw new Error('This desktop is too large to capture. Use a smaller display resolution and try again.');
  return { bounds, screens, singleScreen: screens.length === 1 && displays.length > 1 };
}

function registerScreenshots(handle, getOwner, { hidden = false, fixture = false } = {}) {
  const electron = require('electron');
  const { BrowserWindow, ipcMain, nativeImage } = electron;
  let active = null;
  const page = path.join(__dirname, 'screenshot.html');
  const trusted = event => active?.overlay && event.sender === active.overlay.webContents && event.senderFrame === active.overlay.webContents.mainFrame;
  ipcMain.handle('folio:screenshot-data', event => {
    if (!trusted(event)) throw new Error('Untrusted sender');
    return active.capture;
  });
  ipcMain.on('folio:screenshot-finish', (event, bytes) => {
    if (!trusted(event)) return;
    if (bytes === null) return active.finish(null);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 128 * 1024 * 1024) return active.finish(null);
    const png = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (png.isEmpty()) return active.finish(null);
    active.finish(png.toPNG());
  });
  handle('folio:screenshot-cancel', () => { active?.finish(null); });
  handle('folio:capture-desktop', async () => {
    if (active) throw new Error('A screenshot is already in progress.');
    const owner = getOwner(), visible = owner.isVisible();
    let resolve;
    const result = new Promise(done => { resolve = done; });
    const state = { capture: null, overlay: null, finished: false, finish: bytes => {
      if (state.finished) return;
      state.finished = true; clearTimeout(state.timer);
      owner.removeListener('closed', cancel);
      state.overlay?.destroy(); state.capture = null;
      if (visible && !hidden && !owner.isDestroyed()) { owner.show(); owner.focus(); }
      if (active === state) active = null;
      resolve(bytes);
    } };
    const cancel = () => state.finish(null);
    active = state;
    owner.once('closed', cancel);
    state.timer = setTimeout(() => state.finish(new Error("Screenshot selection timed out. Try again.")), 120000);
    try {
      let capture;
      if (fixture) {
        capture = { bounds: { x: -400, y: 0, width: 800, height: 600 }, screens: [1, 2].map((scale, index) => {
          const image = nativeImage.createFromBitmap(Buffer.alloc(400 * 600 * scale * scale * 4, Buffer.from(index ? [20, 220, 30, 255] : [20, 30, 220, 255])), { width: 400 * scale, height: 600 * scale });
          return { bounds: { x: -400 + index * 400, y: 0, width: 400, height: 600 }, scaleFactor: scale, url: image.toDataURL() };
        }), singleScreen: false };
      } else {
        if (hidden) throw new Error('Desktop capture is disabled in hidden tests.');
        capture = await captureScreens(electron);
      }
      if (state.finished) return null;
      state.capture = capture;
      const overlay = new BrowserWindow({ ...capture.bounds, show: false, frame: false, resizable: false, movable: false,
        enableLargerThanScreen: true, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#181818',
        webPreferences: { preload: path.join(__dirname, 'screenshot-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
          backgroundThrottling: false } });
      state.overlay = overlay;
      overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      overlay.webContents.on('will-navigate', event => event.preventDefault());
      overlay.on('closed', cancel);
      overlay.webContents.on('render-process-gone', () => state.finish(new Error('Screen selection stopped unexpectedly. Try again.')));
      await overlay.loadFile(page);
      if (!state.finished && !hidden) { overlay.setBounds(capture.bounds); overlay.show(); overlay.focus(); }
    } catch (error) {
      state.finish(null);
      throw error;
    }
    const bytes = await result;
    if (bytes instanceof Error) throw bytes;
    return bytes;
  });
}
module.exports = { captureScreens, desktopBounds, registerScreenshots };
