// Exercise real PDF.js stamp editors with synthetic clipboard files; never read or write the OS clipboard.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { captureSave } from "./capture-save.mjs";

const root = path.resolve(import.meta.dirname, ".."), temp = mkdtempSync(path.join(tmpdir(), "doko-paste-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath(env), env,
    args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
  const page = readerPage(await app.firstWindow());
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator('.page[data-page-number="1"] .textLayer span:not(.markedContent)').first().waitFor();
  const paste = (kind = "png", selector = ".viewer-container") => page.evaluate(async ({ kind, selector }) => {
    const data = new DataTransfer();
    if (kind === "png") {
      const canvas = Object.assign(document.createElement("canvas"), { width: 120, height: 60 });
      const g = canvas.getContext("2d"); g.fillStyle = "#ec2781"; g.fillRect(0, 0, 120, 60);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      data.items.add(new File([blob], "Screenshot.png", { type: "image/png" }));
    } else if (kind !== "empty") data.items.add(new File(["broken image"], "bad.png", { type: kind === "broken" ? "image/png" : "application/octet-stream" }));
    return !document.querySelector(selector).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, { kind, selector });
  assert.equal(await paste("empty"), false);
  assert.equal(await paste("unsupported"), false);
  await paste("broken");
  await page.getByText(/Couldn't paste this image/).waitFor();
  assert.equal(await page.locator('.stampEditor').count(), 0, "Invalid PNG created an editor");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText(/Couldn't paste this image/).waitFor();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  // Text inputs keep their normal paste behavior.
  assert.equal(await paste("png", 'input[aria-label="Page number"]'), false);
  assert.equal(await page.locator('.stampEditor').count(), 0);
  for (const mode of ["Select", "Draw"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
    await paste();
    assert.equal(await page.locator('.stampEditor').count(), mode === "Select" ? 0 : 1, "Paste edited behind Settings");
    await page.keyboard.press("Escape");
    assert.equal(await paste(), true);
    await page.waitForFunction(count => [...document.querySelectorAll('.stampEditor canvas')].filter(c => c.width > 0 && c.height > 0).length === count, mode === "Select" ? 1 : 2);
    await page.locator('.dirty-dot').waitFor();
  }
  assert.equal(await page.locator('.stampEditor').count(), 2, "Paste was inserted twice by PDF.js");
  assert.deepEqual(await page.locator('.stampEditor canvas').first().evaluate(canvas => [...canvas.getContext("2d").getImageData(1, 1, 1, 1).data]), [236, 39, 129, 255], "Pasted screenshot pixels changed");
  const saved = path.join(temp, "pasted.pdf");
  await captureSave(app, saved, "pastedSave");
  await page.keyboard.press("ControlOrMeta+Shift+s");
  assert.equal(await app.evaluate(() => globalThis.pastedSave), "completed");
  const result = await page.evaluate(async bytes => {
    const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes) });
    try {
      const pdf = await task.promise, p = await pdf.getPage(1);
      return (await p.getAnnotations()).filter(mark => mark.subtype === "Stamp").map(mark => mark.rect);
    } finally { await task.destroy(); }
  }, Array.from(readFileSync(saved)));
  assert.equal(result.length, 2, "Saved PDF lost pasted screenshots");
  assert.ok(result.every(rect => rect[2] > rect[0] && rect[3] > rect[1]));
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), saved);
  await page.locator('.page[data-page-number="1"] canvas').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.stampAnnotation').length === 2);
  await assertHidden(app); assert.deepEqual(errors, []);
  console.log(`PASS image paste (${process.platform}): Select/Draw PNG, no duplicate, empty/invalid/input guards, saved and reopened PDF; OS clipboard untouched`);
} finally { await closeHidden(app); rmSync(temp, { recursive: true, force: true }); }
