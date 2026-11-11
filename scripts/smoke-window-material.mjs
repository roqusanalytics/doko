// Exercise the real preload/IPC path without showing a window or changing user preferences.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { electronPath } from './electron-path.mjs';
import { assertHidden, closeHidden } from './hidden-window.mjs';

const root = path.resolve(import.meta.dirname, '..');
const profile = mkdtempSync(path.join(tmpdir(), 'doko-window-material-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: profile, FOLIO_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath(env), args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.folioDesktop && !!document.querySelector('iframe.document-reader')?.contentDocument?.querySelector('.app'));
  const supported = await app.evaluate(({ BrowserWindow, nativeTheme }, windowsBuild) => {
    Object.defineProperty(nativeTheme, 'prefersReducedTransparency', { configurable: true, value: false });
    Object.defineProperty(nativeTheme, 'shouldUseHighContrastColors', { configurable: true, value: false });
    const window = BrowserWindow.getAllWindows()[0];
    globalThis.materialTrace = [];
    for (const method of ['setVibrancy', 'setBackgroundMaterial', 'setBackgroundColor']) {
      const original = window[method]?.bind(window);
      if (original) window[method] = value => { globalThis.materialTrace.push([method, value]); return original(value); };
    }
    return process.platform === 'darwin' || process.platform === 'win32' && windowsBuild >= 22621;
  }, Number(release().split('.')[2]));
  await page.evaluate(() => {
    window.nativeMaterialEvents = [];
    window.stopMaterialEvents = window.folioDesktop.onWindowTransparency(enabled => window.nativeMaterialEvents.push(enabled));
  });
  const set = enabled => page.evaluate(enabled => window.folioDesktop.setWindowTransparency(enabled), enabled);
  // getBackgroundColor() drops the alpha channel on macOS; inspect the real API argument instead.
  const background = () => app.evaluate(() => globalThis.materialTrace.filter(([method]) => method === 'setBackgroundColor').at(-1)[1].toLowerCase());
  const event = async enabled => {
    await page.waitForFunction(enabled => window.nativeMaterialEvents.at(-1) === enabled, enabled);
  };
  assert.equal(await set(true), supported);
  await event(supported);
  assert.equal(await background(), supported ? '#00000000' : '#171717');
  const trace = await app.evaluate(() => globalThis.materialTrace);
  if (process.platform === 'darwin') assert.ok(trace.some(([method, value]) => method === 'setVibrancy' && value === 'sidebar'));
  if (process.platform === 'win32' && supported) assert.ok(trace.some(([method, value]) => method === 'setBackgroundMaterial' && value === 'acrylic'));

  await page.evaluate(() => { window.nativeMaterialEvents.length = 0; window.folioDesktop.setTheme('light'); });
  await event(supported);
  assert.equal(await app.evaluate(({nativeTheme}) => nativeTheme.themeSource), 'light', 'native material follows the app theme');
  assert.equal(await background(), supported ? '#00000000' : '#f5f4f1', 'theme changes retain the requested material');
  for (const property of ['prefersReducedTransparency', 'shouldUseHighContrastColors']) {
    await app.evaluate(({ nativeTheme }, property) => {
      Object.defineProperty(nativeTheme, property, { configurable: true, value: true });
      nativeTheme.emit('updated');
    }, property);
    await event(false);
    assert.equal(await background(), '#f5f4f1', `${property}: opaque fallback`);
    await app.evaluate(({ nativeTheme }, property) => {
      Object.defineProperty(nativeTheme, property, { configurable: true, value: false });
      nativeTheme.emit('updated');
    }, property);
    await event(supported);
    assert.equal(await background(), supported ? '#00000000' : '#f5f4f1', `${property}: request survives accessibility change`);
  }
  assert.equal(await set(false), false);
  await event(false);
  assert.equal(await background(), '#f5f4f1');
  for (const invalid of [null, 'yes', 1, {}, []]) await assert.rejects(set(invalid), /must be a boolean/);
  await page.evaluate(() => { window.stopMaterialEvents(); window.nativeMaterialEvents.length = 0; });
  await set(true);
  assert.deepEqual(await page.evaluate(() => window.nativeMaterialEvents), [], 'subscription cleanup removes its listener');
  await set(false);
  console.log(`PASS native window material (${process.platform}): trusted preload/IPC, material, theme, accessibility, disable, invalid input and event cleanup`);
  await assertHidden(app);
} finally {
  if (app) await closeHidden(app);
  rmSync(profile, { recursive: true, force: true });
}
