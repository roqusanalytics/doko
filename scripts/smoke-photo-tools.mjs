import { captureSave } from "./capture-save.mjs";
// Native photo carousel uses the same PDF editors, without showing a window or touching the clipboard.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-photo-tools-"));
const photos = path.join(temp, "Photos");
const shots = path.join(root, "release", "smoke");
mkdirSync(photos); mkdirSync(shots, { recursive: true });
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
let page;
try {
  page = readerPage(await app.firstWindow());
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 800, height: 600 });
    const g = canvas.getContext("2d"); g.fillStyle = "#f0d080"; g.fillRect(0, 0, 800, 600);
    g.fillStyle = "#198754"; g.fillRect(700, 500, 100, 100);
    return canvas.toDataURL().split(",")[1];
  });
  const original = Buffer.from(png, "base64");
  for (const name of ["photo1.png", "photo2.png"]) writeFileSync(path.join(photos, name), original);
  const open = async file => app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  const ready = async name => {
    await page.getByRole("button", { name: `View ${name}`, exact: true }).waitFor();
    await page.waitForFunction(name => document.querySelector(`[aria-label="View ${name}"]`)?.getAttribute("aria-current") === "true" && !document.querySelector('.photo-status') && !!document.querySelector('.page canvas'), name);
  };
  const switchTo = async name => { await page.getByRole("button", { name: `View ${name}`, exact: true }).click(); await ready(name); };
  const download = async (file, action) => {
    await captureSave(app, file, "photoDownload");
    await action();
    assert.equal(await app.evaluate(() => globalThis.photoDownload), "completed");
    await page.waitForFunction(() => document.querySelector('.topbar-center')?.inert === false);
    return readFileSync(file);
  };
  await open(path.join(photos, "photo1.png")); await ready("photo1.png");
  assert.equal(await page.window.locator("iframe.document-reader").count(), 1, "photo opened another editor tab");
  for (const name of ["Select", "Highlight", "Draw", "Text", "Sign", "Edit mode", "Save PNG"]) await page.getByRole("button", { name, exact: true }).waitFor();
  const sheet = page.locator('.page[data-page-number="1"]');
  const width = () => sheet.locator('.canvasWrapper').evaluate(el => el.getBoundingClientRect().width);
  const before = await width();
  await page.getByTitle(/Zoom in \(/).click();
  await page.waitForFunction(before => document.querySelector('.page .canvasWrapper').getBoundingClientRect().width > before, before);
  await page.getByTitle(/Zoom out \(/).click();
  await page.getByTitle("Zoom", { exact: true }).click(); await page.getByRole("menuitem", { name: "100%", exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.page .canvasWrapper').getBoundingClientRect().width - 800) < 2);
  await page.getByTitle("Zoom", { exact: true }).click(); await page.getByRole("menuitem", { name: "Fit image", exact: true }).click();
  console.log("ok  native image opens directly in the shared PDF tools; zoom in/out, 100% and Fit page");

  const drag = async (dx, dy, start = 60) => {
    const layer = sheet.locator('.annotationEditorLayer.inkEditing'); await layer.waitFor();
    const box = await layer.boundingBox();
    await page.mouse.move(box.x + start, box.y + 60); await page.mouse.down();
    await page.mouse.move(box.x + start + dx, box.y + 60 + dy, { steps: 8 }); await page.mouse.up();
  };
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await drag(90, 55);
  await page.getByLabel("Drawing tool", { exact: true }).click(); await page.getByRole("menuitemradio", { name: "Rectangle", exact: true }).click();
  await drag(100, 90, 200);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await sheet.locator('.annotationEditorLayer').click({ position: { x: 250, y: 180 } });
  await sheet.locator('.freeTextEditor .internal[contenteditable="true"]').fill("Photo annotation");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await switchTo("photo2.png");
  await page.window.evaluate(() => { window.photoCloseQuestions = []; window.confirm = message => { window.photoCloseQuestions.push(message); return false; }; });
  await page.keyboard.press("ControlOrMeta+w");
  await page.window.waitForFunction(() => window.photoCloseQuestions.length === 1);
  assert.match(await page.window.evaluate(() => window.photoCloseQuestions[0]), /discard|unsaved/i);
  await switchTo("photo1.png");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await sheet.locator('.freeTextEditor', { hasText: "Photo annotation" }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  console.log("ok  freehand, rectangle and text survive A→B→A; another dirty photo prevents silent close");

  await page.getByRole("button", { name: "Edit mode", exact: true }).click();
  await sheet.getByRole("button", { name: "Image 1", exact: true }).click();
  const replacement = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 8, height: 6 });
    const g = canvas.getContext("2d"); g.fillStyle = "#2040e0"; g.fillRect(0, 0, 8, 6); return canvas.toDataURL().split(",")[1];
  });
  await sheet.getByLabel("Replacement image").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: Buffer.from(replacement, "base64") });
  await page.getByRole("button", { name: "Exit edit mode", exact: true }).click();
  await switchTo("photo2.png"); await switchTo("photo1.png");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const pdfBytes = await download(path.join(temp, "edited.pdf"), () => page.getByRole("menuitem", { name: /Save a copy/ }).click());
  assert.equal(pdfBytes.subarray(0, 4).toString(), "%PDF");
  const saved = await page.evaluate(async bytes => {
    const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes) });
    try { const pdf = await task.promise; const p = await pdf.getPage(1); return { pages: pdf.numPages, annotations: (await p.getAnnotations()).map(a => a.subtype) }; }
    finally { await task.destroy(); }
  }, Array.from(pdfBytes));
  assert.equal(saved.pages, 1); assert.equal(saved.annotations.filter(a => a === "Ink").length, 2); assert.ok(saved.annotations.includes("FreeText"));
  const savedPng = await download(path.join(temp, "edited.png"), () => page.getByRole("button", { name: "Save PNG", exact: true }).click());
  const pixels = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
    const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
    const g = canvas.getContext("2d"); g.drawImage(bitmap, 0, 0); bitmap.close();
    const rgba = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 200 && rgba[i + 3] > 128) dark++;
    return { width: canvas.width, height: canvas.height, corner: [...g.getImageData(750, 550, 1, 1).data], dark };
  }, Array.from(savedPng));
  assert.deepEqual([pixels.width, pixels.height], [800, 600]);
  assert.deepEqual(pixels.corner, [32, 64, 224, 255], "saved PNG did not include the replacement image");
  assert.ok(pixels.dark > 100, "saved PNG did not include drawn annotations/text");
  for (const name of ["photo1.png", "photo2.png"]) assert.deepEqual(readFileSync(path.join(photos, name)), original, "editing overwrote an original");
  writeFileSync(path.join(shots, "photo-edited-export.png"), savedPng);
  await page.screenshot({ path: path.join(shots, "photo-tools-edited.png") });
  console.log("ok  existing-image replacement and all marks export to PDF/PNG at original dimensions; source bytes unchanged");

  const sidebar = page.getByTitle(/Toggle sidebar/); if (await sidebar.getAttribute("aria-pressed") !== "true") await sidebar.click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("textbox", { name: "Notes about this document", exact: true }).fill("Photo reading note");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await page.getByRole("button", { name: "Bookmark page 1", exact: true }).click();
  await switchTo("photo2.png"); await switchTo("photo1.png");
  assert.equal(await page.getByRole("button", { name: "Bookmark page 1", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Notes about this document", exact: true }).inputValue(), "Photo reading note");
  // The native file can exist before the renderer receives its save completion.
  await page.evaluate(() => {
    const saveFile = window.folioDesktop.saveFile;
    window.folioDesktop = { ...window.folioDesktop, saveFile: async (...args) => {
      window.folioDesktop = { ...window.folioDesktop, saveFile };
      const result = await saveFile(...args);
      await new Promise(resolve => setTimeout(resolve, 250));
      return result;
    } };
  });
  await download(path.join(temp, "notes.png"), () => page.keyboard.press("ControlOrMeta+Shift+s"));
  await page.keyboard.press("ControlOrMeta+w");
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  await open(path.join(photos, "photo1.png")); await ready("photo1.png");
  if (await sidebar.getAttribute("aria-pressed") !== "true") await sidebar.click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Notes about this document", exact: true }).inputValue(), "Photo reading note");
  console.log("ok  document notes/bookmark survive navigation; PNG save and reopen retain reading metadata");

  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await drag(90, 55);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await switchTo("photo2.png");
  await page.keyboard.press("ControlOrMeta+,");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Storage", exact: true }).click();
  const stored = settings.locator(".stored-data");
  await stored.locator("summary").click();
  await stored.getByRole("button", { name: "Clear annotations…", exact: true }).click();
  await stored.getByRole("alertdialog").getByRole("button", { name: "Clear annotations", exact: true }).click();
  await stored.getByRole("alertdialog").waitFor({ state: "detached" });
  assert.equal(await stored.getByRole("button", { name: "Clear annotations…", exact: true }).isDisabled(), true);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await switchTo("photo1.png");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Notes about this document", exact: true }).inputValue(), "");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Bookmark page 1", exact: true }).getAttribute("aria-pressed"), "false");
  await page.window.evaluate(() => { window.photoCloseQuestions = []; });
  await page.keyboard.press("ControlOrMeta+w");
  await page.window.waitForFunction(() => window.photoCloseQuestions.length === 1);
  assert.match(await page.window.evaluate(() => window.photoCloseQuestions[0]), /discard|unsaved/i, "clearing metadata lost the unsaved photo warning");
  // Leaving the photo flushes metadata writes before checking that storage stays empty.
  await switchTo("photo2.png"); await switchTo("photo1.png");
  assert.equal(await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("folio");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction("notes"), count = transaction.objectStore("notes").count();
      transaction.oncomplete = () => { db.close(); resolve(count.result); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  })), 0, "cached photo restored cleared reading metadata in storage");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const clearedCopy = await download(path.join(temp, "cleared-photo.pdf"), () => page.getByRole("menuitem", { name: /Save a copy/ }).click());
  assert.equal(await page.evaluate(async bytes => {
    const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes) });
    try {
      const photo = await (await task.promise).getPage(1);
      return (await photo.getAnnotations()).filter(mark => mark.subtype === "Ink").length;
    }
    finally { await task.destroy(); }
  }, Array.from(clearedCopy)), 1, "clearing reading metadata discarded the photo draft bytes");
  await page.keyboard.press("ControlOrMeta+w");
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  await open(path.join(photos, "photo1.png")); await ready("photo1.png");
  if (await sidebar.getAttribute("aria-pressed") !== "true") await sidebar.click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Notes about this document", exact: true }).inputValue(), "");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Bookmark page 1", exact: true }).getAttribute("aria-pressed"), "false");
  console.log("ok  Settings clear removes cached photo notes/bookmarks through A→B→A and reopen, preserving draft edits and dirty warning");

  // Delay the actual bridge response to exercise the refresh lock while the old photo is still present.
  await page.evaluate(() => {
    const original = window.folioDesktop.content.refresh;
    window.folioDesktop = { ...window.folioDesktop, content: { ...window.folioDesktop.content, refresh: async (...args) => { await new Promise(resolve => window.finishPhotoRefresh = resolve); return original(...args); } } };
  });
  await page.getByRole("button", { name: "Refresh gallery", exact: true }).click();
  await page.getByText("Refreshing folder…", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "View photo2.png", exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.topbar-center').evaluate(el => el.inert), true);
  assert.equal(await page.locator('.sidebar-slot').evaluate(el => el.inert), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("button", { name: "View photo1.png", exact: true }).getAttribute("aria-current"), "true");
  await page.evaluate(() => window.finishPhotoRefresh()); await ready("photo1.png");
  console.log("ok  delayed refresh locks editors, sidebar and carousel until a fresh photo is ready");

  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await page.window.setViewportSize({ width, height });
    for (const theme of ["light", "dark"]) {
      await page.keyboard.press("ControlOrMeta+,");
      await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
      await page.getByRole("radiogroup", { name: "Theme", exact: true }).getByRole("radio", { name: theme === "dark" ? "Dark" : "Light", exact: true }).click();
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "photo reader overflows window");
      await page.window.waitForFunction(() => document.querySelectorAll('.window-drag-area').length === 1);
      const geometry = await page.evaluate(() => {
        const area = parent.document.querySelector('.window-drag-area'); const frame = frameElement.getBoundingClientRect();
        const a = area.getBoundingClientRect(); const holes = [...area.children].map(el => el.getBoundingClientRect());
        return { height: a.height, region: parent.getComputedStyle(area).webkitAppRegion, covered: [...document.querySelectorAll('.topbar button')].filter(el => el.getBoundingClientRect().width).every(el => {
          const b = el.getBoundingClientRect(); const center = frame.left + b.left + b.width / 2; return holes.some(h => center >= h.left - 1 && center <= h.right + 1);
        }) };
      });
      assert.ok(geometry.height > 0); assert.equal(geometry.region, "drag"); assert.ok(geometry.covered, "a titlebar button lacks a no-drag hole");
      await page.screenshot({ path: path.join(shots, `photo-tools-${width}-${theme}.png`) });
    }
  }
  await assertHidden(app); assert.deepEqual(errors, []);
  console.log(`PASS photo tools (${process.platform}): carousel edits, copies, metadata, failures, responsive themes and drag geometry`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(shots, "photo-tools-failure.png") }).catch(() => {});
  throw error;
} finally { await closeHidden(app); rmSync(temp, { recursive: true, force: true }); }
