// Synthetic desktop fixtures exercise real hidden windows without capturing the desktop or touching the OS clipboard.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden, closeHidden } from './hidden-window.mjs';
import { captureSave } from './capture-save.mjs';
const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'doko-screenshot-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: '1', FOLIO_TEST_SCREENSHOT: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env, timeout: 60_000 });
try {
  const window = await app.firstWindow(), page = readerPage(window);
  await page.getByRole('button', { name: /Try a sample/ }).waitFor();
  const mockClipboard = async () => page.evaluate(() => {
    window.screenshotWrites = []; window.screenshotDeny = false;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async items => {
      if (window.screenshotDeny) throw new Error('Denied');
      window.screenshotWrites.push(await items[0].getType('image/png'));
    } } });
  });
  await page.getByRole('button', { name: /Try a sample/ }).click();
  await page.locator('.textLayer span:not(.markedContent)').first().waitFor();
  await mockClipboard();
  const closeKey = async (overlay, key) => {
    try { await overlay.keyboard.press(key); } catch (error) { if (!overlay.isClosed()) throw error; }
  };
  const start = async () => {
    const opened = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Take a screenshot' }).click();
    const overlay = await opened;
    await overlay.locator('#screens img').first().waitFor();
    await overlay.locator('#capture:focus').waitFor();
    await assertHidden(app);
    return overlay;
  };
  const drag = async (overlay, from, to) => {
    await overlay.mouse.move(...from); await overlay.mouse.down();
    await overlay.mouse.move(...to, { steps: 12 }); await overlay.mouse.up();
    await page.getByRole('toolbar', { name: 'Screenshot actions' }).waitFor();
  };
  const image = () => page.evaluate(async () => {
    const blob = window.screenshotWrites.at(-1), bitmap = await createImageBitmap(blob);
    const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
    return { type: blob.type, width: bitmap.width, height: bitmap.height,
      left: [...context.getImageData(0, 0, 1, 1).data], right: [...context.getImageData(bitmap.width - 1, 0, 1, 1).data] };
  });
  // All four drag directions cross the synthetic negative-coordinate 1× and 2× displays.
  for (const [from, to] of [[[420,380],[180,160]], [[180,160],[420,380]], [[420,160],[180,380]], [[180,380],[420,160]]]) {
    await drag(await start(), from, to);
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    const before = await page.locator('.stampEditor').count();
    await page.getByRole('button', { name: 'Copied', exact: true }).evaluate(async button => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 2, height: 2 });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const data = new DataTransfer(); data.items.add(new File([blob], 'test.png', { type: 'image/png' }));
      button.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    assert.equal(await page.locator('.stampEditor').count(), before, 'screenshot preview must block background PDF paste');
    const png = await image();
    assert.deepEqual(png, { type: 'image/png', width: 480, height: 440, left: [220,30,20,255], right: [30,220,20,255] });
    await page.keyboard.press('Escape'); await page.locator('.screenshot-overlay').waitFor({ state: 'detached' });
  }
  await drag(await start(), [101,101], [102,102]);
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  assert.deepEqual(await image(), { type: 'image/png', width: 1, height: 1, left: [220,30,20,255], right: [220,30,20,255] });
  await page.keyboard.press('Escape');
  const writes = await page.evaluate(() => window.screenshotWrites.length);
  const clicked = await start();
  await clicked.mouse.click(300,300);
  assert.equal(await clicked.locator('#selection').isHidden(), true);
  // Pointer cancellation discards a partial selection rather than copying it.
  await clicked.locator('#capture').dispatchEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  await clicked.locator('#capture').dispatchEvent('pointercancel', { pointerId: 1 });
  await closeKey(clicked, 'Escape');
  await page.getByRole('button', { name: 'Take a screenshot' }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.screenshotWrites.length), writes);
  // Keyboard-only whole desktop capture; Tab stays inside the result dialog.
  await closeKey(await start(), 'Enter');
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  assert.deepEqual((( { width, height }) => ({ width, height }))(await image()), { width: 1600, height: 1200 });
  await page.getByRole('button', { name: 'Close', exact: true }).focus(); await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Copied', exact: true }).evaluate(el => el === document.activeElement), true);
  // Save PNG uses the normal file boundary and writes selected PNG bytes, not the full desktop.
  const saved = path.join(temp, 'selection.png');
  await captureSave(app, saved, 'screenshotSave');
  await page.getByRole('button', { name: 'Save…', exact: true }).click();
  await page.locator('.screenshot-overlay').waitFor({ state: 'detached' });
  assert.deepEqual([...readFileSync(saved).subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  await drag(await start(), [420,380], [180,160]);
  await page.getByRole('toolbar', { name: 'Screenshot actions' }).getByRole('button', { name: 'Draw', exact: true }).click();
  await page.locator('.document-tab.selected').getByText(/^Screenshot .*\.png$/).waitFor();
  await page.locator('.canvasWrapper canvas').first().waitFor();
  await page.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await mockClipboard();
  await page.evaluate(() => { window.screenshotDeny = true; });
  await drag(await start(), [420,380], [180,160]);
  await page.getByText("Couldn't copy to the clipboard. Try Copy or save the image.", { exact: true }).waitFor();
  await page.evaluate(() => { window.screenshotDeny = false; });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await assertHidden(app);
  const shots = path.join(root, 'release', 'smoke'); mkdirSync(shots, { recursive: true });
  await window.screenshot({ path: path.join(shots, 'screenshot-draw.png') });
  console.log('PASS screenshot: four drag directions, mixed DPI/negative coordinates and PNG pixels, keyboard, cancel, clipboard denial/retry, Save PNG, Draw; desktop and OS clipboard untouched');
} finally { await closeHidden(app); rmSync(temp, { recursive: true, force: true }); }
