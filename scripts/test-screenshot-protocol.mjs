// Exercise the packaged overlay with the production file:// fuse, never the desktop or OS clipboard.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPackage } from '@electron/asar';
import { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { _electron as electron } from 'playwright-core';
import { electronPath } from './electron-path.mjs';
import { assertHidden, closeHidden } from './hidden-window.mjs';

// Kept inside the fixture ASAR so both its preload and static files use real packaged paths.
function fixtureMain() {
  const { app, BrowserWindow, protocol, net } = require('electron');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { registerScreenshots } = require('./electron/screenshot.cjs');
  app.setPath('userData', process.env.FOLIO_TEST_USER_DATA);
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock.hide();
    protocol.handle('app', request => {
      const { host, pathname } = new URL(request.url);
      if (host !== 'folio' || !['/screenshot.html', '/screenshot-overlay.js', '/screenshot-overlay.css'].includes(pathname)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(path.join(__dirname, 'dist', pathname)).toString());
    });
    const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await owner.loadURL('about:blank');
    registerScreenshots((channel, handler) => {
      if (channel === 'folio:capture-desktop') globalThis.captureScreenshot = handler;
    }, () => owner, { hidden: true, fixture: true });
    globalThis.oldFileResult = async () => {
      const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      try {
        await probe.loadFile(path.join(__dirname, 'dist', 'screenshot.html'));
        return 'loaded';
      } catch (error) { return error.message; }
      finally { probe.close(); }
    };
  });
}

const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'doko-screenshot-protocol-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, 'profile'), FOLIO_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app, copiedBundle;
try {
  const executable = electronPath(env);
  const source = process.platform === 'darwin'
    ? executable.slice(0, executable.lastIndexOf('.app/') + 4) : path.dirname(executable);
  copiedBundle = path.join(temp, path.basename(source));
  if (process.platform === 'darwin') {
    execFileSync('/bin/cp', ['-c', '-R', source, copiedBundle]);
    // The cached hidden bundle may carry Finder metadata; codesign rejects it on a private copy.
    execFileSync('/usr/bin/xattr', ['-cr', copiedBundle]);
  } else cpSync(source, copiedBundle, { recursive: true });
  const copiedExecutable = path.join(copiedBundle, path.relative(source, executable));
  await flipFuses(process.platform === 'darwin' ? copiedBundle : copiedExecutable, {
    version: FuseVersion.V1, [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    resetAdHocDarwinSignature: process.platform === 'darwin',
  });
  const wire = await getCurrentFuseWire(process.platform === 'darwin' ? copiedBundle : copiedExecutable);
  assert.equal(wire[FuseV1Options.GrantFileProtocolExtraPrivileges], '0'.charCodeAt(0));

  const fixture = path.join(temp, 'fixture');
  mkdirSync(path.join(fixture, 'electron'), { recursive: true });
  mkdirSync(path.join(fixture, 'dist'));
  for (const file of ['screenshot.cjs', 'screenshot-preload.cjs']) {
    cpSync(path.join(root, 'electron', file), path.join(fixture, 'electron', file));
  }
  for (const file of ['screenshot.html', 'screenshot-overlay.js', 'screenshot-overlay.css']) {
    cpSync(path.join(root, 'dist', file), path.join(fixture, 'dist', file));
  }
  writeFileSync(path.join(fixture, 'main.cjs'), `(${fixtureMain.toString()})();`);
  writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'screenshot-protocol-fixture', version: '1.0.0', main: 'main.cjs' }));
  const resources = path.join(copiedBundle, process.platform === 'darwin' ? 'Contents/Resources' : 'resources');
  await createPackage(fixture, path.join(resources, 'app.asar'));
  app = await electron.launch({ executablePath: copiedExecutable, env,
    args: ['--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], timeout: 30_000 });
  await app.firstWindow();
  await assertHidden(app);
  await app.evaluate(async () => {
    for (let i = 0; i < 100 && !globalThis.captureScreenshot; i++) await new Promise(resolve => setTimeout(resolve, 20));
    if (!globalThis.captureScreenshot) throw new Error('Screenshot fixture did not initialize');
  });
  const overlayReady = app.waitForEvent('window');
  await app.evaluate(() => {
    globalThis.captureResult = globalThis.captureScreenshot().then(bytes => ({ length: bytes?.length ?? 0 }), error => ({ error: error.message }));
  });
  const overlay = await overlayReady;
  await overlay.waitForFunction(() => document.images.length === 2
    && [...document.images].every(image => image.complete && image.naturalWidth > 0)
    && document.activeElement?.id === 'capture');
  assert.equal(new URL(overlay.url()).protocol, 'app:');
  try { await overlay.keyboard.press('Enter'); } catch (error) { if (!overlay.isClosed()) throw error; }
  const result = await app.evaluate(() => globalThis.captureResult);
  assert.ok(result.length > 100, `packaged screenshot failed: ${JSON.stringify(result)}`);
  const fileResult = await app.evaluate(() => globalThis.oldFileResult());
  assert.match(fileResult, /ERR_FILE_NOT_FOUND/, 'the old file:// path must fail despite its file existing in the ASAR');
  await assertHidden(app);
  console.log('PASS packaged screenshot: file:// rejected with its production fuse disabled; app:// overlay, real preload and synthetic PNG selection work; desktop and clipboard untouched');
} finally {
  try {
    if (app) await closeHidden(app);
  } finally {
    try {
      if (process.platform === 'darwin' && copiedBundle) {
        execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-u', copiedBundle], { stdio: 'ignore' });
      }
    } finally {
      // Windows can briefly retain the copied executable's lock after the process tree exits.
      rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
}
