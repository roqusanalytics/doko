import { closeHidden } from "./hidden-window.mjs";
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden } from './hidden-window.mjs';
const root = path.resolve(import.meta.dirname, '..'), temp = mkdtempSync(path.join(tmpdir(), 'doko-material-alpha-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env });
try {
  const window = await app.firstWindow(), page = readerPage(window);
  await page.getByRole('button', { name: /Try a sample/ }).waitFor();
  const supported = await app.evaluate(({ nativeTheme }) => process.platform === 'darwin' && !nativeTheme.prefersReducedTransparency && !nativeTheme.shouldUseHighContrastColors);
  if (!supported) { console.log('SKIP material alpha: native macOS material unavailable'); }
  else {
    await window.evaluate(() => localStorage.setItem('folio:window-transparency', 'true'));
    await window.reload();
    await page.getByRole('button', { name: /Try a sample/ }).click();
    await window.waitForFunction(() => document.documentElement.hasAttribute('data-window-material'));
    const sidebar = page.getByRole('button', { name: /^Toggle sidebar/ });
    if (await sidebar.getAttribute('aria-pressed') !== 'true') await sidebar.click();
    await page.waitForTimeout(350);
    const measure = async () => {
    const points = await page.evaluate(() => {
      const side = document.querySelector('.sidebar').getBoundingClientRect(), stage = document.querySelector('.stage').getBoundingClientRect();
      return { navbar: [innerWidth - 200, 2], edge: [2, innerHeight - 3], sidebar: [side.right - 12, side.top + side.height / 2], canvas: [stage.right - 5, stage.top + stage.height / 2],
        css: { body: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme, sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor } };
    });
    const png = await window.screenshot({ omitBackground: true, scale: 'css' });
    const alpha = await app.evaluate(({ nativeImage }, { png, points }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png)), { width } = image.getSize(), bytes = image.toBitmap();
      return Object.fromEntries(['navbar', 'edge', 'sidebar', 'canvas'].map(key => { const [x, y] = points[key].map(Math.floor); return [key, bytes[(y * width + x) * 4 + 3]]; }));
    }, { png:[...png], points });
    console.log(JSON.stringify({ alpha, css: points.css }));
    return alpha;
    };
    const settings = async () => { await page.locator('body').click({position:{x:5,y:5}}); await page.keyboard.press('Meta+Comma'); };
    for (const theme of ['Light', 'Dark']) {
      await settings(); await page.getByRole('radio', {name:theme,exact:true}).click(); await page.keyboard.press('Escape');
      const alpha = await measure();
      assert.ok(alpha.navbar <= 64, `${theme}: enabled frame transmits native backdrop`);
      assert.equal(alpha.edge, alpha.navbar, `${theme}: the frame edge and the top bar must be one tone`);
      assert.equal(alpha.sidebar, 255, `${theme}: the sidebar stays an opaque panel like the work area`);
      assert.equal(alpha.canvas, 255, `${theme}: working canvas stays opaque`);
    }
    await settings();
    await page.getByRole('radio', {name:'Light',exact:true}).click();
    await page.getByRole('button', {name:'Custom background',exact:true}).click();
    await page.getByRole('textbox', {name:'Custom color',exact:true}).fill('#282d33');
    await page.getByRole('textbox', {name:'Custom color',exact:true}).press('Tab');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await app.evaluate(({nativeTheme}) => nativeTheme.themeSource), 'dark', 'Dark custom background uses dark native material even in Light theme');
    await settings(); await page.getByRole('switch', {name:'Window transparency',exact:true}).click(); await page.keyboard.press('Escape');
    await window.waitForFunction(() => !document.documentElement.hasAttribute('data-window-material'));
    const solid = await measure();
    assert.deepEqual(solid, {navbar:255,edge:255,sidebar:255,canvas:255}, 'Disabled transparency restores fully opaque surfaces');
  }
  await assertHidden(app);
} finally { await closeHidden(app); rmSync(temp, { recursive:true, force:true }); }
