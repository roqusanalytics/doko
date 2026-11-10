import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-photo-view-"));
const photos = path.join(temp, "Photos"); mkdirSync(photos);
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
try {
  const page = readerPage(await app.firstWindow());
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  const sizes = [[320, 240], [3000, 2000], [900, 2400], ...Array.from({ length: 22 }, () => [640, 480])];
  for (const [index, [width, height]] of sizes.entries()) {
    const png = await page.evaluate(({ width, height }) => {
      const canvas = Object.assign(document.createElement("canvas"), { width, height });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#e1ecdf"; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#142720"; ctx.font = `${Math.round(width / 15)}px sans-serif`; ctx.fillText(`${width} × ${height}`, width / 12, height / 2);
      return canvas.toDataURL().split(",")[1];
    }, { width, height });
    writeFileSync(path.join(photos, `photo${index + 1}.png`), Buffer.from(png, "base64"));
  }
  const open = file => app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  const ready = async name => {
    await page.getByRole("button", { name: `View ${name}`, exact: true }).waitFor();
    return page.waitForFunction(name => document.querySelector(`[aria-label="View ${name}"]`)?.getAttribute("aria-current") === "true"
    && !document.querySelector('.photo-status') && document.querySelector('.page canvas')?.width > 0, name);
  };
  const select = async name => { await page.getByRole("button", { name: `View ${name}`, exact: true }).click(); await ready(name); };
  const checkFit = async (width, height) => {
    await page.waitForFunction(({ width, height }) => {
      const container = document.querySelector('.viewer-container');
      const box = document.querySelector('.page .canvasWrapper')?.getBoundingClientRect();
      if (!box) return false;
      const ratio = Math.min(1, (container.clientWidth - 32) / width, (container.clientHeight - 104) / height);
      return Math.abs(box.width - width * ratio) <= 2 && Math.abs(box.height - height * ratio) <= 2;
    }, { width, height });
    const geometry = await page.evaluate(() => {
      const container = document.querySelector('.viewer-container').getBoundingClientRect();
      const page = document.querySelector('.page .canvasWrapper').getBoundingClientRect();
      const canvas = document.querySelector('.page .canvasWrapper > canvas');
      return { bottom: page.bottom, available: container.bottom - 70, left: page.left, edge: container.left,
        canvasWidth: canvas.width, cssWidth: page.width, dpr: devicePixelRatio };
    });
    assert.ok(geometry.bottom <= geometry.available + 2, "photo overlaps bottom controls");
    assert.ok(geometry.left >= geometry.edge, "photo cropped on left");
    assert.ok(geometry.canvasWidth >= geometry.cssWidth * Math.min(2, geometry.dpr) - 2, "rendered canvas is undersized");
  };
  await open(path.join(photos, "photo1.png")); await ready("photo1.png"); await checkFit(...sizes[0]);
  await select("photo2.png"); await checkFit(...sizes[1]);
  await select("photo3.png"); await checkFit(...sizes[2]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
  await checkFit(...sizes[2]);
  await page.getByTitle("Zoom", { exact: true }).click(); await page.getByRole("menuitem", { name: "100%", exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.page .canvasWrapper').getBoundingClientRect().width - 900) < 2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  assert.ok(Math.abs(await page.locator('.page .canvasWrapper').evaluate(el => el.getBoundingClientRect().width) - 900) < 2, "resize reset manual zoom");
  await select("photo2.png"); await checkFit(...sizes[1]);
  console.log("ok  small/large/portrait photos fit dynamically without upscaling or cropping; resize and actual-pixel 100% retain quality");

  const strip = page.locator('.photo-carousel-thumbnails');
  await strip.evaluate(el => el.scrollLeft = 0);
  await strip.hover(); await page.mouse.wheel(0, 700);
  await page.waitForFunction(() => document.querySelector('.photo-carousel-thumbnails').scrollLeft > 200);
  assert.equal(await page.getByLabel("Image position").innerText(), "2 / 25", "thumbnail scrolling changed selected image");
  await page.locator('.page').hover(); await page.mouse.wheel(0, 120);
  // One trackpad gesture must not skip multiple photos as the current photo finishes loading.
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 20);
  await ready("photo3.png"); await checkFit(...sizes[2]);
  assert.equal(await page.getByLabel("Image position").innerText(), "3 / 25");
  await page.window.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator('.photo-carousel-thumbnail').first().evaluate(el => getComputedStyle(el).transitionDuration), "0s");
  await page.screenshot({ path: path.join(root, "release/smoke/photo-dynamic-fit.png") });
  await assertHidden(app);
  console.log("ok  mouse wheel scrolls thumbnail strip and changes fitted photos; gesture guard and reduced-motion respected");
} finally { await closeHidden(app); rmSync(temp, { recursive: true, force: true }); }
