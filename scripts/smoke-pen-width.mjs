import { closeHidden } from "./hidden-window.mjs";
import { captureSave } from "./capture-save.mjs";
// Ink widths must follow the current document's zoom after a photo switch.
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden } from './hidden-window.mjs';
const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'folio-pen-width-'));
const photos = path.join(temp, 'Photos'); mkdirSync(photos);
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, 'profile'), FOLIO_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])] });
try {
  const page = readerPage(await app.firstWindow());
  await page.getByRole('button', { name: /Try a sample/ }).waitFor();
  for (const [name, width, height] of [['small.png', 200, 150], ['large.png', 4000, 3000]]) {
    const png = await page.evaluate(({ width, height }) => {
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL().split(',')[1];
    }, { width, height });
    writeFileSync(path.join(photos, name), Buffer.from(png, 'base64'));
  }
  const ready = async name => {
    await page.waitForFunction(name => document.querySelector(`[aria-label="View ${name}"]`)?.getAttribute('aria-current') === 'true' && !document.querySelector('.photo-status') && !!document.querySelector('.page canvas'), name);
  };
  const switchTo = async name => { await page.getByRole('button', { name: `View ${name}`, exact: true }).click(); await ready(name); };
  const stroke = async (y, pageWidth, thickness = 1) => {
    const layer = page.locator('.page .annotationEditorLayer.inkEditing'); await layer.waitFor();
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + 60, box.y + y); await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + y, { steps: 10 }); await page.mouse.up();
    const measured = await page.locator('.page svg.draw').last().evaluate((svg, pageWidth) => {
      const scale = svg.closest('.page').querySelector('.canvasWrapper').getBoundingClientRect().width / pageWidth;
      return { width: Number(svg.getAttribute('stroke-width')), scale };
    }, pageWidth);
    assert.ok(Math.abs(measured.width - measured.scale * thickness) < .02, `${thickness}pt pen width ${measured.width}px differs from current scale ${measured.scale}`);
  };
  const choose = async (label, value) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('menuitemradio', { name: value, exact: true }).click();
  };
  await app.evaluate(({ app }, file) => app.emit('open-file', { preventDefault() {} }, file), path.join(photos, 'small.png'));
  await ready('small.png');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await stroke(60, 200);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await switchTo('large.png');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Pen width', exact: true }).innerText(), 'Thin');
  await stroke(60, 4000);
  await choose('Pen width', 'Medium'); await stroke(120, 4000, 3);
  await choose('Pen width', 'Thick'); await stroke(180, 4000, 6);
  await choose('Drawing tool', 'Rectangle'); await choose('Drawing tool', 'Pen');
  assert.equal(await page.getByRole('button', { name: 'Pen width', exact: true }).innerText(), 'Thick');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const file = path.join(temp, 'widths.pdf');
  await captureSave(app, file, "penDownload");
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: /Save a copy/ }).click();
  assert.equal(await app.evaluate(() => globalThis.penDownload), 'completed');
  const widths = await page.evaluate(async bytes => {
    const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes) });
    try { return (await (await (await task.promise).getPage(1)).getAnnotations()).filter(a => a.subtype === 'Ink').map(a => a.borderStyle.rawWidth).sort((a, b) => a - b); }
    finally { await task.destroy(); }
  }, Array.from(readFileSync(file)));
  assert.deepEqual(widths, [1, 3, 6], 'changing width altered earlier strokes');
  await switchTo('small.png');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await choose('Pen width', 'Thin');
  await stroke(100, 200);
  console.log('ok  first Thin stroke uses current photo scale after A→B→A; Medium/Thick and tool switches preserve prior widths in saved PDF');
  await assertHidden(app);
} finally {
  // The isolated fixture intentionally has unsaved strokes; closing must not open a native dialog.
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }).catch(() => {});
  await closeHidden(app); rmSync(temp, { recursive: true, force: true });
}
