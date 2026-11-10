import { closeHidden } from "./hidden-window.mjs";
// Run after npm run build; use a disposable profile and keep Electron hidden.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden } from './hidden-window.mjs';
const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'doko-annotation-toolbar-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env, timeout: 60_000 });
try {
  const window = await app.firstWindow();
  const page = readerPage(window);
  await page.getByRole('button', { name: /Try a sample/ }).click();
  await page.locator('.textLayer span:not(.markedContent)').first().waitFor();
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  const createHighlight = async () => {
    const line = page.locator('.textLayer.highlighting').getByText(/Drag a PDF file anywhere/);
    await line.scrollIntoViewIfNeeded();
    await line.hover();
    const box = await line.boundingBox();
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(60, box.width - 1), box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.locator('.highlightEditor').waitFor();
  };
  await createHighlight();
  const remove = page.getByRole('button', { name: 'Remove highlight', exact: true });
  await remove.waitFor({ timeout: 5000 });
  const checkIcon = async (remove, label, pseudoType = 'before') => {
    const l10nId = await remove.getAttribute('data-l10n-id');
    const cdp = await app.context().newCDPSession(window);
    await cdp.send('DOM.enable');
    const { root: tree } = await cdp.send('DOM.getDocument', { depth:-1, pierce:true });
    const find = node => {
      if (node.nodeName === 'BUTTON' && node.attributes?.includes(l10nId)) return node;
      for (const child of [...(node.children || []), ...(node.contentDocument ? [node.contentDocument] : [])]) {
        const found = find(child);
        if (found) return found;
      }
    };
    const button = find(tree);
    assert.ok(button, `${label}: toolbar button must exist`);
    const { node } = await cdp.send('DOM.describeNode', { backendNodeId:button.backendNodeId, depth:1 });
    const icon = node.pseudoElements?.find(n => n.pseudoType === pseudoType);
    assert.ok(icon, `${label}: toolbar icon must exist`);
    const bounds = model => {
      const x = model.border.filter((_, i) => i % 2 === 0);
      const y = model.border.filter((_, i) => i % 2 === 1);
      return { left:Math.min(...x), right:Math.max(...x), top:Math.min(...y), bottom:Math.max(...y) };
    };
    const outer = bounds((await cdp.send('DOM.getBoxModel', { backendNodeId:button.backendNodeId })).model);
    const inner = bounds((await cdp.send('DOM.getBoxModel', { backendNodeId:icon.backendNodeId })).model);
    console.log(label, JSON.stringify({ button:outer, icon:inner }));
    await cdp.detach();
    assert.ok(inner.left >= outer.left - 1 && inner.right <= outer.right + 1
      && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1,
      `${label}: icon must stay inside its button`);
  };
  const checkRemoveStates = async (button, label) => {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await button.hover();
      await page.waitForTimeout(200);
      const state = async () => button.evaluate(element => {
        const css = getComputedStyle(element);
        const rgba = color => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        return { background: rgba(css.backgroundColor), icon: rgba(getComputedStyle(element, '::before').backgroundColor),
          outline: css.outlineStyle, outlineWidth: parseFloat(css.outlineWidth), outlineColor: rgba(css.outlineColor), radius: css.borderRadius };
      });
      let css = await state();
      assert.equal(css.radius, '12px', `${label} ${theme}: rounded delete target`);
      assert.ok(css.background[0] > css.background[1] && css.background[3] > 0, `${label} ${theme}: red hover fill`);
      assert.ok(css.icon[0] > css.icon[1] * 1.4, `${label} ${theme}: red hover icon`);
      if (label === 'Ink' || label === 'Free text') await window.screenshot({ path:path.join(tmpdir(), `doko-object-${label === 'Ink' ? 'ink' : 'text'}-${theme}.png`) });
      await page.mouse.move(1, 1);
      await button.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      css = await state();
      assert.ok(css.background[0] > css.background[1] && css.background[3] > 0 && css.icon[0] > css.icon[1] * 1.4, `${label} ${theme}: red keyboard-only fill and icon`);
      assert.ok(css.outline !== 'none' && css.outlineWidth >= 2 && css.outlineColor[0] > css.outlineColor[1] * 1.4, `${label} ${theme}: contrasting red keyboard focus`);
    }
    await page.mouse.move(1, 1);
  };
  const checkSelection = async (editor, label) => {
    await editor.locator(".editToolbar .deleteButton").focus();
    await editor.hover({ force: true });
    const css = await editor.evaluate(element => {
      const css = getComputedStyle(element);
      return { radius: css.borderRadius, background: css.backgroundColor, border: css.borderColor, outline: css.outlineStyle };
    });
    assert.equal(css.radius, '12px', `${label}: rounded object selection`);
    assert.notEqual(css.background, 'rgba(0, 0, 0, 0)', `${label}: soft selection fill`);
    assert.equal(css.border, 'rgba(0, 0, 0, 0)', `${label}: no decorative border`);
    assert.equal(css.outline, 'none', `${label}: no pointer selection outline`);
    await page.keyboard.press('Tab');
    await editor.focus();
    const focus = await editor.evaluate(element => {
      const css = getComputedStyle(element);
      return { visible: element.matches(':focus-visible'), outline: css.outlineStyle, width: parseFloat(css.outlineWidth) };
    });
    assert.ok(focus.visible && focus.outline !== 'none' && focus.width >= 2, `${label}: selected object retains keyboard focus`);

  };
  await checkIcon(remove, 'Highlight default');
  await checkRemoveStates(remove, 'Highlight');
  const colorPicker = page.locator('.highlightEditor .editToolbar .colorPicker');
  await checkIcon(colorPicker, 'Highlight color picker', 'after');
  await colorPicker.click();
  await colorPicker.locator('.dropdown').waitFor({ state: 'visible' });
  await colorPicker.click();
  await colorPicker.locator('.dropdown').waitFor({ state: 'hidden', timeout: 1500 });
  assert.equal(await colorPicker.getAttribute('aria-expanded'), 'false', 'closed palette reports collapsed state');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await colorPicker.click();
    await colorPicker.locator('.dropdown').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await colorPicker.locator('.dropdown').waitFor({ state: 'hidden' });
    assert.equal(await colorPicker.getAttribute('aria-expanded'), 'false', `${theme}: Escape closes highlight colors`);
    await colorPicker.click();
    await page.locator('.topbar-center').click({ position: { x: 1, y: 1 } });
    await colorPicker.locator('.dropdown').waitFor({ state: 'hidden' });
    assert.equal(await colorPicker.getAttribute('aria-expanded'), 'false', `${theme}: outside click closes highlight colors`);
  }
  await colorPicker.click();
  await colorPicker.locator('button[data-color]').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.highlightEditor .colorPicker .swatch').style.backgroundColor !== 'rgb(255, 216, 77)');
  console.log('PASS highlight color picker changes selected annotation');
  for (const [width, height, zoom] of [[960, 780, '100%'], [1440, 1000, '200%'], [700, 800, 'Fit width']]) {
    await remove.click();
    await page.getByRole('button', { name:'Select', exact:true }).click();
    await window.setViewportSize({ width, height });
    const sidebar = page.getByRole('button', { name:/^Toggle sidebar/ });
    if (width < 800 && await sidebar.getAttribute('aria-pressed') === 'true') await sidebar.click();
    await page.getByTitle('Zoom', { exact:true }).click();
    await page.getByRole('menuitem', { name:zoom, exact:true }).click();
    await page.getByRole('button', { name:'Highlight', exact:true }).click();
    await createHighlight();
    await remove.waitFor({ timeout:5000 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await checkIcon(remove, `Highlight ${width}px ${zoom} ${theme}`);
    }
  }
  await window.screenshot({ path:path.join(tmpdir(), 'doko-annotation-toolbar-after.png') });
  await remove.click();
  assert.equal(await page.locator('.highlightEditor').count(), 0, 'Remove must delete the selected highlight');
  await window.setViewportSize({ width:1000, height:800 });
  await page.getByTitle('Zoom', { exact:true }).click();
  await page.getByRole('menuitem', { name:'100%', exact:true }).click();
  await page.getByRole('button', { name:'Text', exact:true }).click();
  await page.locator('.page[data-page-number="1"] .annotationEditorLayer').click();
  await page.locator('.freeTextEditor .internal[contenteditable="true"]').fill('Toolbar layout check');
  await page.keyboard.press('Escape');
  await page.locator('.freeTextEditor').click({ force:true });
  const textRemove = page.locator('.freeTextEditor .editToolbar .deleteButton');
  await textRemove.waitFor({ timeout:5000 });
  await checkIcon(textRemove, 'Free text');
  await checkSelection(page.locator('.freeTextEditor'), 'Free text');
  await checkRemoveStates(textRemove, 'Free text');
  await textRemove.click();
  assert.equal(await page.locator('.freeTextEditor').count(), 0, 'Remove must delete the text annotation');
  await page.getByRole('button', { name:'Draw', exact:true }).click();
  const ink = page.locator('.page[data-page-number="1"] .annotationEditorLayer.inkEditing');
  await ink.waitFor();
  const inkBox = await ink.boundingBox();
  const x = inkBox.x + inkBox.width * .3, y = Math.max(90, inkBox.y + inkBox.height * .4);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 80, y + 30, { steps:8 }); await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.locator('.inkEditor').waitFor();
  await page.getByRole('button', { name:'Draw', exact:true }).click();
  await page.locator('.inkEditor').click({ force:true });
  const inkRemove = page.locator('.inkEditor .editToolbar .deleteButton');
  await inkRemove.waitFor({ timeout:5000 });
  await checkIcon(inkRemove, 'Ink');
  await checkSelection(page.locator('.inkEditor'), 'Ink');
  await checkRemoveStates(inkRemove, 'Ink');
  await inkRemove.click();
  assert.equal(await page.locator('.inkEditor').count(), 0, 'Remove must delete the ink annotation');
  await assertHidden(app);
  console.log('PASS annotation toolbar');
} catch (error) {
  const window = await app.firstWindow();
  await window.screenshot({path:path.join(tmpdir(), 'doko-toolbar-failure.png')});
  throw error;
} finally { await closeHidden(app); rmSync(temp, { recursive:true, force:true }); }
