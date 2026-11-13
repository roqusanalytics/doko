import { closeHidden } from "./hidden-window.mjs";
// Run after npm run build; exercise control states in a hidden, disposable Electron profile.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden } from './hidden-window.mjs';

const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'doko-control-states-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath(env), args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env, timeout: 60_000 });
  const window = await app.firstWindow();
  const page = readerPage(window);
  const cdp = await window.context().newCDPSession(window);
  const standardMedia = [{ name: 'prefers-reduced-transparency', value: 'no-preference' }, { name: 'prefers-contrast', value: 'no-preference' }];
  await cdp.send('Emulation.setEmulatedMedia', { features: standardMedia });
  await page.getByRole('button', { name: /Try a sample/ }).click();
  await page.locator('.textLayer span:not(.markedContent)').first().waitFor();
  const draw = page.getByRole('button', { name: 'Draw', exact: true });
  const palette = page.getByRole('toolbar', { name: 'Annotation options' });
  const colors = palette.getByRole('radio');
  const style = locator => locator.evaluate(element => {
    const css = getComputedStyle(element);
    return { background: css.backgroundColor, color: css.color, border: css.border,
      borderWidth: parseFloat(css.borderWidth), borderColor: css.borderColor, shadow: css.boxShadow,
      radius: css.borderRadius, outline: css.outlineStyle,
      outlineWidth: parseFloat(css.outlineWidth), outlineColor: css.outlineColor,
      focusVisible: element.matches(':focus-visible') };
  });
  const opaque = color => color !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(color);
  const radius = async (locator, label) => assert.equal((await style(locator)).radius, '12px', `${label}: 12px radius`);
  const hover = async locator => {
    await locator.hover();
    await page.waitForTimeout(250); // Let the existing control color transitions finish.
    return style(locator);
  };
  const keyboardFocus = async (locator, label) => {
    await locator.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const css = await style(locator);
    assert.ok(css.focusVisible && css.outline !== 'none' && css.outlineWidth >= 2 && opaque(css.outlineColor), `${label}: keyboard focus has a visible outline`);
  };
  const borderless = async (locator, label) => {
    const css = await style(locator);
    assert.ok(!css.shadow.includes('inset') && (css.borderWidth === 0 || !opaque(css.borderColor)), `${label}: no decorative border or inset ring`);
  };
  const selectedContrast = async label => {
    const contrast = await draw.evaluate(element => {
      const css = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const luminance = color => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgba = context.getImageData(0, 0, 1, 1).data;
        if (rgba[3] !== 255) throw new Error(`Selected color must be opaque: ${color}`);
        return Array.from(rgba.slice(0, 3), value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
      };
      const foreground = luminance(css.color), background = luminance(css.backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    assert.ok(contrast >= 4.5, `${label}: selected Draw text contrast ${contrast.toFixed(2)} must be >= 4.5`);
    console.log(`PASS ${label}: selected Draw contrast ${contrast.toFixed(2)}`);
  };

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const icons = await page.locator('.app-icon').evaluateAll(elements => elements.map(icon => {
      const style = getComputedStyle(icon), size = Number(icon.getAttribute('width'));
      return { size, weight: Number(icon.getAttribute('stroke-width')) * size / 24,
        shrink: style.flexShrink, caps: style.strokeLinecap, joins: style.strokeLinejoin };
    }));
    assert.ok(icons.length > 10, `${theme}: shared icons are present across the reader`);
    for (const icon of icons) {
      assert.ok(icon.weight >= 1.5, `${theme}: no hairline icon strokes at ${icon.size}px`);
      if (icon.size <= 20) assert.ok(Math.abs(icon.weight - 1.5) < .001, `${theme}: compact icons share the same visible weight`);
      assert.deepEqual([icon.shrink, icon.caps, icon.joins], ['0', 'round', 'round']);
    }
    const dots = page.locator('.topbar .app-icon circle[fill="currentColor"]');
    assert.equal(await dots.count(), 3, `${theme}: ellipsis uses three clean filled dots`);
    assert.deepEqual(await dots.evaluateAll(elements => elements.map(dot => getComputedStyle(dot).stroke)), ['none', 'none', 'none']);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(250);
    const normal = await style(draw);
    await radius(draw, `${theme} Draw`);
    const hovered = await hover(draw);
    assert.ok(opaque(hovered.background), `${theme} Draw: hover has a background`);
    assert.notEqual(hovered.background, normal.background, `${theme} Draw: hover differs from idle`);
    await keyboardFocus(draw, `${theme} Draw`);
    await page.keyboard.press('Space');
    assert.equal(await draw.getAttribute('aria-pressed'), 'true', `${theme} Draw: selected state`);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(250);
    const selected = await style(draw);
    assert.ok(opaque(selected.background), `${theme} Draw: selected has a background`);
    assert.notEqual(selected.background, hovered.background, `${theme} Draw: selected differs from hover`);
    await borderless(draw, `${theme} selected Draw`);
    await selectedContrast(theme);
    const selectedHover = await hover(draw);
    assert.equal(selectedHover.background, selected.background, `${theme} selected Draw: hover preserves active background`);
    assert.equal(selectedHover.color, selected.color, `${theme} selected Draw: hover preserves accent foreground`);
    await page.mouse.move(1, 1);

    await window.setViewportSize({ width: 1100, height: 800 });
    const sidebarToggle = page.getByRole('button', { name: /^Toggle sidebar/ });
    if (await sidebarToggle.getAttribute('aria-pressed') !== 'true') await sidebarToggle.click();
    const inactiveTab = page.getByRole('tab', { name: 'Outline', exact: true });
    const idleTab = await style(inactiveTab);
    const hoveredTab = await hover(inactiveTab);
    assert.ok(opaque(hoveredTab.background), `${theme} sidebar tab: hover has a soft background`);
    assert.notEqual(hoveredTab.background, idleTab.background, `${theme} sidebar tab: hover differs from idle`);
    await borderless(page.getByRole('tab', { name: 'Pages', exact: true }), `${theme} selected sidebar tab`);
    await borderless(sidebarToggle, `${theme} selected icon button`);

    const width = page.getByRole('button', { name: 'Pen width', exact: true });
    await radius(width, `${theme} Pen width`);
    await borderless(width, `${theme} Pen width`);
    await keyboardFocus(width, `${theme} Pen width`);
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Pen width options' });
    await menu.waitFor();
    const material = async (locator, solid) => {
      const css = await locator.evaluate(element => {
        const css = getComputedStyle(element);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        context.fillStyle = css.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return { alpha: context.getImageData(0, 0, 1, 1).data[3], filter: css.backdropFilter };
      });
      assert.equal(css.filter === 'none', solid, `${theme}: material blur follows accessibility preference`);
      assert.ok(solid ? css.alpha === 255 : css.alpha >= 220 && css.alpha < 255, `${theme}: material opacity ${css.alpha}, solid=${solid}`);
    };
    await material(page.locator(".sidebar"), true);
    await material(palette, false);
    await material(menu, false);
    for (const feature of ['prefers-reduced-transparency', 'prefers-contrast']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: standardMedia.map(setting => setting.name === feature ? { name: feature, value: feature === 'prefers-contrast' ? 'more' : 'reduce' } : setting) });
      await material(page.locator(".sidebar"), true);
      await material(palette, true);
      await material(menu, true);
      const exitStyle = await page.evaluate(() => {
        // A CSS fixture avoids requesting fullscreen from the hidden Electron window.
        const button = document.createElement('button');
        button.className = 'exit-focus';
        document.body.append(button);
        const css = getComputedStyle(button);
        const result = { opacity: css.opacity, filter: css.backdropFilter };
        button.remove();
        return result;
      });
      assert.deepEqual(exitStyle, { opacity: '1', filter: 'none' }, `${theme}: accessibility fallback keeps Exit focus fully opaque`);
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: standardMedia });
    assert.equal(await page.locator('.page').first().evaluate(element => getComputedStyle(element).backdropFilter), 'none', 'Document content does not use glass');
    await window.screenshot({ path: path.join(tmpdir(), `doko-control-states-desktop-${theme}.png`) });
    await radius(menu, `${theme} width menu`);
    const widthOptions = menu.getByRole('menuitemradio');
    const firstRow = await widthOptions.nth(0).boundingBox(), secondRow = await widthOptions.nth(1).boundingBox();
    assert.ok(firstRow.height <= 28, `${theme}: compact menu hover surface`);
    assert.ok(secondRow.y - firstRow.y - firstRow.height >= 2, `${theme}: menu surfaces have breathing room`);

    const option = widthOptions.nth(await widthOptions.first().getAttribute('aria-checked') === 'true' ? 2 : 0);
    const optionLabel = await option.innerText();
    await radius(option, `${theme} width option`);
    const idleOption = await style(option);
    const hoveredOption = await hover(option);
    assert.ok(opaque(hoveredOption.background), `${theme} width option: hover has a background`);
    assert.notEqual(hoveredOption.background, idleOption.background, `${theme} width option: hover differs from idle`);
    await option.click();
    assert.equal(await width.innerText(), optionLabel, `${theme} width selection updates trigger`);

    assert.ok(await colors.count() > 1, `${theme}: color choices exist`);
    const nextColor = colors.nth(await colors.first().getAttribute('aria-checked') === 'true' ? 1 : 0);
    await keyboardFocus(nextColor, `${theme} color`);
    await page.keyboard.press('Space');
    assert.equal(await palette.locator('[role="radio"][aria-checked="true"]').count(), 1, `${theme}: exactly one selected color`);
    assert.equal(await nextColor.getAttribute('aria-checked'), 'true', `${theme}: keyboard selects color`);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(250);
    const selectedColor = await style(nextColor);
    const hoveredColor = await hover(nextColor);
    assert.equal(hoveredColor.background, selectedColor.background, `${theme} checked color: hover preserves active background`);
    assert.equal(hoveredColor.border, selectedColor.border, `${theme} checked color: hover preserves selected border`);
    assert.equal(hoveredColor.shadow, selectedColor.shadow, `${theme} checked color: hover preserves selected shadow`);
    for (const color of await colors.all()) {
      await radius(color, `${theme} color target`);
      const geometry = await color.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const candidates = [getComputedStyle(element, '::before'), getComputedStyle(element, '::after'),
          ...Array.from(element.children, child => getComputedStyle(child))];
        return { width: bounds.width, height: bounds.height, circle: candidates.some(css => {
          const width = parseFloat(css.width), height = parseFloat(css.height);
          const r = css.borderRadius;
          return width > 0 && height > 0 && width === height && (r === '50%' || parseFloat(r) >= width / 2)
            && css.display !== 'none' && css.content !== 'none' && css.backgroundColor !== 'rgba(0, 0, 0, 0)';
        }) };
      });
      assert.ok(geometry.width >= 28 && geometry.height >= 28, `${theme}: color target is at least 28px`);
      assert.ok(geometry.circle, `${theme}: color swatch remains circular inside the target`);
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: [...standardMedia, { name: 'forced-colors', value: 'active' }] });
    for (const [control, label] of [[draw, 'selected Draw'], [sidebarToggle, 'selected icon'], [page.getByRole('tab', { name: 'Pages', exact: true }), 'selected sidebar tab']]) {
      await keyboardFocus(control, `${theme} forced-colors ${label}`);
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: standardMedia });
    await window.setViewportSize({ width: 390, height: 844 });
    const sidebar = page.getByRole('button', { name: /^Toggle sidebar/ });
    if (await sidebar.getAttribute('aria-pressed') === 'true') await sidebar.click();
    await page.waitForTimeout(350);
    const bounds = await palette.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: innerWidth };
    });
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.viewport + 1, `${theme}: annotation palette fits 390px viewport (${JSON.stringify(bounds)})`);
    for (const button of await palette.locator('button:visible').all()) {
      const reachable = await button.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      });
      assert.ok(reachable, `${theme}: mobile palette control is unobscured (${await button.getAttribute('aria-label') || await button.getAttribute('title') || await button.innerText()})`);
    }
    await window.screenshot({ path: path.join(tmpdir(), `doko-control-states-${theme}.png`) });
    await window.setViewportSize({ width: 1100, height: 800 });
    console.log(`PASS ${theme}: control radius, hover, keyboard focus, selected states, color swatches and mobile palette`);
  }
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma');
  await page.getByRole('button', { name: 'Custom background', exact: true }).click();
  await page.getByRole('textbox', { name: 'Custom color', exact: true }).fill('#555555');
  await page.keyboard.press('Escape');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await draw.click();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(250);
    await selectedContrast(`${theme} custom #555555`);
  }
  await assertHidden(app);
  console.log('PASS control states');
} catch (error) {
  if (app) await (await app.firstWindow()).screenshot({ path: path.join(tmpdir(), 'doko-control-states-failure.png') }).catch(() => {});
  throw error;
} finally {
  if (app) await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
