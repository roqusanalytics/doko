// A selected drawing (pdf.js gives it z-index 100000) must stay under Doko's own dialogs.
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden, closeHidden } from './hidden-window.mjs';
const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'folio-draw-layering-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, 'profile'), FOLIO_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])] });
try {
  const page = readerPage(await app.firstWindow());
  await page.getByRole('button', { name: /Try a sample/ }).click();
  await page.locator('.page canvas').first().waitFor();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Drawing tool', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Rectangle', exact: true }).click();
  const box = await page.locator('.page').first().boundingBox();
  await page.mouse.move(box.x + 80, box.y + 120); await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 300, { steps: 10 }); await page.mouse.up();
  const editor = page.locator('.annotationEditorLayer .inkEditor').first();
  await editor.waitFor();
  await page.mouse.click(box.x + 80, box.y + 200);
  await page.locator('.annotationEditorLayer .inkEditor.selectedEditor').waitFor();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma');
  await page.locator('.modal-backdrop').waitFor();
  const covered = await editor.evaluate(ed => {
    const r = ed.getBoundingClientRect();
    return [[.5, .5], [0, 0], [1, 0], [0, 1], [1, 1]].every(([fx, fy]) =>
      !ed.contains(document.elementFromPoint(r.x + r.width * fx + (fx ? -2 : 2), r.y + r.height * fy + (fy ? -2 : 2))));
  });
  assert.ok(covered, 'selected drawing or its handles render above the Settings dialog');
  console.log('ok  selected drawing stays under the Settings dialog');
  await assertHidden(app);
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }).catch(() => {});
  await closeHidden(app); rmSync(temp, { recursive: true, force: true });
}
