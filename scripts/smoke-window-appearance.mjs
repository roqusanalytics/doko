import { closeHidden } from "./hidden-window.mjs";
// Exercise the saved chrome preference and text-only hover in a disposable hidden reader.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden } from './hidden-window.mjs';
const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'doko-window-appearance-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath(env), args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env });
  const window = await app.firstWindow(), page = readerPage(window);
  await window.setViewportSize({ width: 1360, height: 900 });
  await page.getByRole('button', { name: /Try a sample/ }).click();
  await page.locator('.textLayer span:not(.markedContent)').first().waitFor();
  const tools = page.getByRole('toolbar', { name: 'Tools', exact: true });
  const layer = await tools.evaluate(element => { const css = getComputedStyle(element); return [css.backgroundColor, css.boxShadow]; });
  assert.deepEqual(layer, ['rgba(0, 0, 0, 0)', 'none'], 'tool buttons have no enclosing black layer');
  const draw = page.getByRole('button', { name: 'Draw', exact: true });
  const geometry = () => draw.evaluate(element => {
    const text = element.querySelector('span'), icon = element.querySelector('svg');
    return { text: text.getBoundingClientRect().y, icon: icon.getBoundingClientRect().y, transform: getComputedStyle(text).transform, stroke: icon.getAttribute('stroke-width') };
  });
  await page.mouse.move(1, 1); const before = await geometry();
  await draw.hover(); await page.waitForTimeout(350); const after = await geometry();
  assert.ok(Math.abs(after.text - before.text + 1) < .1, 'hover raises only the label by one pixel');
  const motion = await draw.locator('span').evaluate(element => { const css = getComputedStyle(element); return { duration: css.transitionDuration, easing: css.transitionTimingFunction }; });
  assert.ok(parseFloat(motion.duration) >= .24 && motion.easing.startsWith('cubic-bezier'), 'label lift uses a gentle eased transition');
  assert.equal(after.icon, before.icon, 'hover keeps the icon stationary');
  assert.equal(after.stroke, '1.6', 'shared icons use the refreshed consistent stroke');
  await window.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal((await geometry()).transform, 'none', 'Reduce Motion disables label movement');
  await window.emulateMedia({ reducedMotion: 'no-preference' });
  await window.setViewportSize({ width: 700, height: 800 });
  assert.equal(await draw.locator('span').evaluate(element => getComputedStyle(element).display), 'none', 'compact toolbar labels stay hidden');
  const sidebarToggle = page.getByRole('button', { name: /^Toggle sidebar/ });
  await sidebarToggle.click(); await sidebarToggle.click();
  await window.setViewportSize({ width: 1100, height: 800 });

  await page.evaluate(() => {
    const card = document.createElement('div'); card.id = 'contrast-fixture'; card.className = 'msg-error';
    Object.assign(card.style, { position: 'fixed', right: '12px', top: '70px', zIndex: '100' });
    card.innerHTML = '<p>Usage limit</p><a class="btn primary" href="#">Manage usage</a>';
    document.body.append(card);
  });
  const primary = page.locator('#contrast-fixture .btn');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const hovered of [false, true]) {
      if (hovered) await primary.hover(); else await page.mouse.move(1, 1);
      await page.waitForTimeout(200);
      const text = await primary.evaluate(element => {
        const css = getComputedStyle(element), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        const luminance = color => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const pixel = context.getImageData(0, 0, 1, 1).data;
          if (pixel[3] !== 255) throw new Error('Primary text and fill must stay opaque');
          return [...pixel.slice(0, 3)].map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        };
        const a = luminance(css.color), b = luminance(css.backgroundColor);
        return { filter: css.filter, size: parseFloat(css.fontSize), weight: parseFloat(css.fontWeight), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
      assert.equal(text.filter, 'none', 'primary actions never filter/rasterize their label on hover');
      assert.ok(text.size >= 13 && Number.isInteger(text.size) && text.weight >= 600, 'compact action labels use crisp 13px+ semibold text');
      assert.ok(text.ratio >= 7, `${theme}: primary text contrast ${text.ratio.toFixed(2)}`);
      console.log(`PASS ${theme} ${hovered ? 'hover' : 'idle'} primary text contrast ${text.ratio.toFixed(2)}`);
    }
  }
  await window.screenshot({ path:path.join(tmpdir(), 'doko-action-contrast-after.png') });
  await page.locator('#contrast-fixture').evaluate(element => element.remove());
  const settings = async () => { await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma'); };
  await settings();
  const toggle = page.getByRole('switch', { name: 'Window transparency', exact: true });
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'transparency defaults off');
  await toggle.focus(); await page.keyboard.press('Space');
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await window.waitForFunction(() => document.documentElement.hasAttribute('data-window-transparency') && [...document.querySelectorAll('iframe.document-reader')].every(frame => frame.contentDocument.documentElement.hasAttribute('data-window-transparency')));
  assert.equal(await page.evaluate(() => localStorage.getItem('folio:window-transparency')), 'true');
  const nativeExpected = await app.evaluate(({nativeTheme}, windowsBuild) => (process.platform === 'darwin' || process.platform === 'win32' && windowsBuild >= 22621) && !nativeTheme.prefersReducedTransparency && !nativeTheme.shouldUseHighContrastColors, Number(release().split('.')[2]));
  await window.waitForFunction(expected => document.documentElement.hasAttribute('data-window-material') === expected && [...document.querySelectorAll('iframe.document-reader')].every(frame => frame.contentDocument.documentElement.hasAttribute('data-window-material') === expected), nativeExpected);
  await page.evaluate(() => { window.originalPreferenceWrite = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Test storage unavailable'); }; });
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'failed persistence leaves the active setting intact');
  await page.getByRole('alert').filter({ hasText: "Couldn't save this preference" }).waitFor();
  await page.evaluate(() => { Storage.prototype.setItem = window.originalPreferenceWrite; });

  const canvas = () => page.locator('.stage').evaluate(element => {
    const css = getComputedStyle(element), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.fillStyle = css.backgroundColor; context.fillRect(0, 0, 1, 1);
    return [context.getImageData(0, 0, 1, 1).data[3], css.opacity];
  });
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('radio', { name: theme, exact: true }).click();
    assert.deepEqual(await canvas(), [255, '1'], `${theme}: working canvas stays opaque`);
  }
  await page.keyboard.press('Escape');
  // Composite bright/dark backdrops under translucent chrome; selected pixels stay opaque.
  const selected = page.getByRole('button', {name:'Select',exact:true});
  const side = page.getByRole('tab', {name:'Pages',exact:true});
  for (const scheme of ['light','dark']) {
    await page.evaluate(scheme => { document.documentElement.dataset.theme = scheme; document.documentElement.style.colorScheme = scheme; }, scheme);
    for (const backdrop of ['#ffffff','#101010']) {
      await page.evaluate(backdrop => { document.documentElement.style.backgroundColor = backdrop; }, backdrop);
      await page.waitForTimeout(250);
      for (const control of [selected, side, sidebarToggle]) {
        const colors = await control.evaluate(element => {
          const css = getComputedStyle(element), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          const rgba = color => { context.clearRect(0,0,1,1); context.fillStyle = color; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data]; };
          return {bg:rgba(css.backgroundColor),fg:rgba(css.color),source:rgba(css.getPropertyValue("--bg"))};
        });
        const expected = [197,206,199].map((channel,i) => Math.round(channel*.84 + colors.source[i]*.16));
        assert.equal(colors.bg[3],255,'selection stays opaque over native material');
        assert.ok(expected.every((channel,i) => Math.abs(channel-colors.bg[i]) <= 1), `${scheme} / ${backdrop}: selection follows the appearance background`);
        const luminance = rgba => rgba.slice(0,3).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
        const a=luminance(colors.bg), b=luminance(colors.fg);
        assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 7, 'selected text retains strong contrast');
      }
      await selected.hover(); await page.waitForTimeout(300);
      const hoverFill = await selected.evaluate(element => getComputedStyle(element).backgroundColor);
      await page.mouse.move(1,1); await page.waitForTimeout(300);
      assert.equal(await selected.evaluate(element => getComputedStyle(element).backgroundColor), hoverFill, 'hover preserves selected fill');
      await window.screenshot({path:path.join(tmpdir(), `doko-glass-selected-${scheme}-${backdrop === '#ffffff' ? 'bright' : 'dark'}.png`)});
    }
  }
  const paletteFills = [];
  for (const palette of ['Ocean','Slate','Sage']) {
    await settings();
    await page.getByRole('radio', {name:'Light',exact:true}).click();
    await page.getByRole('button', {name:`${palette} background`,exact:true}).click();
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    paletteFills.push(await selected.evaluate(element => getComputedStyle(element).backgroundColor));
  }
  assert.equal(new Set(paletteFills).size,3,'selected fill changes instantly with appearance presets');
  await settings(); await page.getByRole('button', {name:'Custom background',exact:true}).click();
  const custom = page.getByRole('textbox', {name:'Custom color',exact:true});
  await custom.fill('#000000'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const darkFill = await selected.evaluate(element => getComputedStyle(element).backgroundColor);
  await settings(); await custom.fill('#ffffff'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const lightFill = await selected.evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(darkFill,lightFill,'custom appearance background updates selection without restarting');
  const expectedFill = await selected.evaluate(element => getComputedStyle(element).backgroundColor);
  for (const name of ['Highlight','Draw','Text','Select']) {
    const control = page.getByRole('button', {name,exact:true}); await control.click(); await page.waitForTimeout(200);
    const fill = await control.evaluate(element => { const css=getComputedStyle(element); return [css.backgroundColor,css.color]; });
    assert.deepEqual(fill, [expectedFill,'rgb(26, 26, 26)'], `${name}: tool-specific rules preserve adaptive neutral/Ink selection`);
  }
  await page.evaluate(() => { document.documentElement.style.removeProperty('color-scheme'); document.documentElement.style.removeProperty('background-color'); });
  console.log('PASS selected glass controls: opaque fills, light/dark schemes and backdrops, >=7:1 text, stable hover');
  await window.screenshot({ path:path.join(tmpdir(), 'doko-window-transparency-on.png') });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+t' : 'Control+t');
  await page.getByRole('button', { name: /Try a sample/ }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-window-transparency')), true, 'new tab inherits preference');
  await window.reload();
  await page.getByRole('button', { name: /Try a sample/ }).waitFor();
  await settings();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'reload retains preference');
  await toggle.click();
  await window.waitForFunction(() => !document.documentElement.hasAttribute('data-window-transparency') && !document.documentElement.hasAttribute('data-window-material'));
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'preference can be disabled');
  await page.keyboard.press('Escape');
  const teardownErrors=[];window.on('pageerror',error=>teardownErrors.push(error.message));
  await window.evaluate(()=>document.documentElement.remove());
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('folio:window-transparency',true));
  await window.waitForTimeout(100);
  assert.deepEqual(teardownErrors,[],'native material event tolerates a document being torn down');
  await window.reload();await page.getByRole('button',{name:/Try a sample/}).waitFor();
  await assertHidden(app);
  console.log('PASS window transparency: default, keyboard toggle, themes, opaque canvas, tab sync, reload, disable, stationary icons and reduced-motion hover');
} catch (error) {
  if (app) await (await app.firstWindow()).screenshot({ path:path.join(tmpdir(), 'doko-window-appearance-failure.png') }).catch(() => {});
  throw error;
} finally { if (app) await closeHidden(app); rmSync(temp, { recursive:true, force:true }); }
