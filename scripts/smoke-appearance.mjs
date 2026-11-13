// Run after npm run build. Every window stays hidden and uses a disposable profile.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-appearance-"));
const markdown = path.join(temp, "Appearance.md");
writeFileSync(markdown, "# Appearance\n\nReadable content across document tabs.\n");
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const window = await app.firstWindow();
  const page = readerPage(window);
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator(".textLayer span:not(.markedContent)").first().waitFor();
  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 80, height: 60 });
    const context = canvas.getContext("2d"); context.fillStyle = "#55aa99"; context.fillRect(0, 0, 80, 60);
    return canvas.toDataURL().split(",")[1];
  });
  const photo = path.join(temp, "Appearance.png");
  writeFileSync(photo, Buffer.from(png, "base64"));
  const openSettings = async () => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
    await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  };
  await openSettings();
  assert.equal(await page.getByRole("textbox", { name: "Custom color", exact: true }).inputValue(), "#76736f");
  assert.equal(await page.getByRole("textbox", { name: "Work area", exact: true }).inputValue(), "#202327");
  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("radio", { name: theme, exact: true }).click();
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--bg") === "#76736f"
      && getComputedStyle(document.querySelector(".sidebar")).backgroundColor === "rgb(32, 35, 39)");
  }
  mkdirSync(path.join(root, "release", "smoke"), { recursive: true });
  await page.screenshot({ path: path.join(root, "release", "smoke", "appearance-default-colors.png") });
  // Simulate an upgraded profile with previous custom colors.
  await window.evaluate(() => {
    localStorage.setItem("folio:appearance", "ocean");
    localStorage.setItem("folio:panel-color", "#ffffff");
    localStorage.removeItem("folio:default-colors-v1");
  });
  await window.reload();
  await page.locator(".textLayer span:not(.markedContent)").first().waitFor();
  await openSettings();
  assert.equal(await page.getByRole("textbox", { name: "Custom color", exact: true }).inputValue(), "#76736f");
  assert.equal(await page.getByRole("textbox", { name: "Work area", exact: true }).inputValue(), "#202327");
  assert.equal(await page.locator(".appearance-card").count(), 6, "5 presets plus Custom are required");
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Sage background", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--bg") === "#e2eadf");
  // The frame follows the background; only the work area takes an exact color, persists it, rejects bad input, and Auto clears it.
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--frame")), "#e2eadf", "the palette sets the frame");
  assert.equal(await page.getByRole("textbox", { name: "Frame", exact: true }).count(), 0, "the frame has no separate color");
  const workField = page.getByRole("textbox", { name: "Work area", exact: true });
  await workField.fill("#fafafa");
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--stage") === "#fafafa");
  assert.equal(await page.evaluate(() => localStorage.getItem("folio:panel-color")), "#fafafa");
  await workField.fill("red");
  await page.getByText("Enter a color like #A1B2C3 or #ABC.").first().waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("folio:panel-color")), "#fafafa", "bad input keeps the saved color");
  await workField.fill("#" + "a".repeat(5000));
  assert.equal(await page.evaluate(() => localStorage.getItem("folio:panel-color")), "#fafafa");
  await page.locator(".appearance-color", { has: workField }).getByRole("button", { name: "Auto" }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("folio:panel-color")), "");
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--frame")), "#e2eadf", "the frame still follows the background");
  // Text adapts to an exact work-area color: a dark panel in the Light theme gets light, readable text.
  const contrastOf = selector => page.evaluate(selector => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map(c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const style = getComputedStyle(document.querySelector(selector));
    const a = lum(rgb(style.color)), b = lum(rgb(style.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);
  await page.getByRole("textbox", { name: "Work area", exact: true }).fill("#1b1f24");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".sidebar")).backgroundColor === "rgb(27, 31, 36)");
  assert.ok(await contrastOf(".sidebar") >= 4.5, "sidebar text must stay readable on a dark work-area color in the Light theme");
  await page.getByRole("textbox", { name: "Work area", exact: true }).fill("#8ff5c0");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".sidebar")).backgroundColor === "rgb(143, 245, 192)");
  assert.ok(await contrastOf(".sidebar") >= 4.5, "sidebar text must stay readable on a light work-area color");
  await page.locator(".appearance-color", { has: page.getByRole("textbox", { name: "Work area", exact: true }) }).getByRole("button", { name: "Auto" }).click();
  await page.waitForFunction(() => !document.getElementById("folio-surface-colors"));
  await window.waitForFunction(() => document.documentElement.style.getPropertyValue("--bg") === "#e2eadf");
  await page.getByRole("button", { name: "Custom background", exact: true }).click();
  await page.getByRole("textbox", { name: "Custom color", exact: true }).fill("#e4eaf2");
  const hex = page.getByRole("textbox", { name: "Custom color", exact: true });
  for (const invalid of ["", "not-a-color", "x".repeat(10000)]) {
    await hex.fill(invalid);
    assert.equal(await hex.getAttribute("aria-invalid"), "true");
    assert.equal(await page.evaluate(() => localStorage.getItem("folio:appearance")), "#e4eaf2", "invalid input changed the saved palette");
  }
  for (const color of ["#000000", "#ffffff", "#00ff00", "#ABC"]) {
    await hex.fill(color);
    assert.equal(await hex.getAttribute("aria-invalid"), "false");
  }
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark" && document.documentElement.style.getPropertyValue("--bg") === "#aabbcc");
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), "#c5e1cb", "custom backgrounds must retain the Mint accent");
  await page.getByRole("button", { name: "Ocean background", exact: true }).click();
  await page.keyboard.press("Escape");
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), photo);
  await page.getByRole("button", { name: "View Appearance.png", exact: true }).waitFor();
  await page.locator(".page canvas").first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), "ocean", "new photo frame lost appearance");
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), markdown);
  await page.getByLabel("Markdown preview", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), "ocean", "new Markdown frame lost appearance");
  await window.reload();
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), "ocean", "reload lost appearance");
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), markdown);
  await page.getByLabel("Markdown preview", { exact: true }).waitFor();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  await openSettings();
  assert.equal(await page.getByRole("button", { name: "Ocean background", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await window.waitForFunction(() => [...document.querySelectorAll("iframe.document-reader")].every(frame => frame.contentDocument.documentElement.dataset.appearance === "#76736f"));
  assert.equal(await page.getByRole("textbox", { name: "Custom color", exact: true }).inputValue(), "#76736f");
  await page.getByRole("button", { name: "Paper background", exact: true }).click();
  await window.waitForFunction(() => [...document.querySelectorAll("iframe.document-reader")].every(frame => !frame.contentDocument.documentElement.dataset.appearance));
  assert.equal(await page.getByRole("button", { name: "Paper background", exact: true }).getAttribute("aria-pressed"), "true");
  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("radio", { name: theme, exact: true }).click();
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), "#c5e1cb", "Paper must use the Mint accent in both themes");
    await window.waitForFunction(theme => [...document.querySelectorAll("iframe.document-reader")]
      .every(frame => frame.contentDocument.documentElement.dataset.theme === theme), theme.toLowerCase());
    const contrast = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const luminance = color => {
        color = color.trim();
        if (color.length === 4) color = "#" + [...color.slice(1)].map(v => v + v).join("");
        const c = [1, 3, 5].map(i => parseInt(color.trim().slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
      };
      const text = luminance(css.getPropertyValue("--text-3"));
      const contrast = ["--bg", "--stage", "--surface", "--surface-2"].map(key => {
        const bg = luminance(css.getPropertyValue(key)); return (Math.max(text, bg) + .05) / (Math.min(text, bg) + .05);
      });
      const accent = luminance(css.getPropertyValue("--accent")), foreground = luminance(css.getPropertyValue("--accent-foreground"));
      contrast.push((Math.max(accent, foreground) + .05) / (Math.min(accent, foreground) + .05));
      // Section-marker CSS is loaded in the existing Markdown frame, not the library frame.
      const markerDocument = [...window.parent.document.querySelectorAll("iframe.document-reader")]
        .map(frame => frame.contentDocument).find(doc => doc?.querySelector(".markdown-pane"));
      if (!markerDocument) throw new Error("Missing Markdown frame for indicator contrast check");
      const indicators = markerDocument.createElement("div");
      indicators.innerHTML = '<span class="dirty-dot"></span><span class="recent-progress"></span><span class="loading-bar"></span><button class="markdown-section-button" aria-current="location"><span class="markdown-section-mark"></span></button>';
      markerDocument.body.append(indicators);
      try {
        for (const marker of indicators.querySelectorAll(".dirty-dot, .recent-progress, .loading-bar, .markdown-section-mark")) {
          const rgb = getComputedStyle(marker).backgroundColor.match(/[\d.]+/g);
          if (!rgb || Number(rgb[3] ?? 1) < 1) throw new Error(`${marker.className} has no opaque visible color`);
          const ink = luminance("#" + rgb.slice(0, 3).map(v => Number(v).toString(16).padStart(2, "0")).join(""));
          for (const key of ["--bg", "--surface", "--surface-2"]) {
            const bg = luminance(css.getPropertyValue(key));
            contrast.push((Math.max(ink, bg) + .05) / (Math.min(ink, bg) + .05));
          }
        }
      } finally { indicators.remove(); }
      return contrast;
    });
    assert.ok(contrast.every(value => value >= 4.5), `Paper ${theme} text and status-indicator contrast: ${contrast}`);
  }
  await page.locator(".modal").evaluate(el => el.scrollTop = 0);
  const shots = path.join(root, "release", "smoke");
  mkdirSync(shots, { recursive: true });
  await window.setViewportSize({ width: 390, height: 700 });
  assert.ok(await page.locator(".appearance-card").evaluateAll(cards => cards.every(card => {
    const rect = card.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth;
  })), "appearance cards overflow narrow screen");
  await page.screenshot({ path: path.join(shots, "appearance-390.png") });
  await window.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200); // Let the theme's existing color transition settle for visual evidence.
  await page.screenshot({ path: path.join(shots, "appearance-settings.png") });
  await assertHidden(app);
  console.log("PASS appearance hidden Electron: presets, live parent/frame sync, invalid/long/custom input, Dark theme, PDF/photo/Markdown, reload, reset");
} finally { await closeHidden(app); rmSync(temp, { recursive: true, force: true }); }
