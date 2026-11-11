function fileMenuTemplate({ platform, send, open, state = { kind: 'none', busy: false } }) {
  const active = state.kind !== 'none' && !state.busy;
  // Workbooks and HTML are read-only; only workbooks support Print.
  const writable = active && !['workbook', 'html'].includes(state.kind);
  const action = (label, command, accelerator, enabled = active) => ({ label, enabled, accelerator, click: () => send('folio:file-command', command) });
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu', label: 'Doko', submenu: [
      { role: 'about', label: 'About Doko' }, { type: 'separator' }, { role: 'services' },
      { type: 'separator' }, { role: 'hide', label: 'Hide Doko' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit', label: 'Quit Doko' },
    ] }] : []),
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => send('folio:tab-command', 'new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: open },
      action('Open Recent…', 'recent', undefined, true),
      { type: 'separator' },
      action('Save', 'save', 'CmdOrCtrl+S', writable),
      action('Save As…', 'save-as', 'CmdOrCtrl+Shift+S', writable),
      action('Export / Convert…', 'export', undefined, writable),
      action('Reduce File Size…', 'compress', undefined, active && ['pdf', 'photo'].includes(state.kind)),
      { type: 'separator' },
      action('Print…', 'print', 'CmdOrCtrl+P', active && state.kind !== 'html'),
      action('Properties…', 'properties', undefined, writable),
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('folio:tab-command', 'close') },
      ...(platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [action('Hand Tool', 'hand', undefined, active && ['pdf', 'photo'].includes(state.kind)), { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
}
module.exports = { fileMenuTemplate };
