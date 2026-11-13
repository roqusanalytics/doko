// Real image-only PDFs, real OCR, isolated hidden Electron profile. Run after npm run build.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-ocr-search-"));
const shots = path.join(root, "release", "smoke");
mkdirSync(shots, { recursive: true });
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
const errors = [];
let page;
try {
  page = readerPage(await app.firstWindow());
  page.on("pageerror", error => errors.push(String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const pdf = await PDFDocument.create();
  for (const text of ["Reference code: 7319", "Delivery city: Kaunas", "AMBER RIVER 8426", "Reference code: 7319"]) {
    const png = await page.evaluate(text => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 1400, height: 700 });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1400, 700);
      ctx.fillStyle = "black"; ctx.font = "60px sans-serif";
      ctx.fillText(text, 70, 180);
      ctx.fillText("Total: 84.00 EUR", 70, 280);
      return canvas.toDataURL("image/png").split(",")[1];
    }, text);
    const image = await pdf.embedPng(Buffer.from(png, "base64"));
    pdf.addPage([700, 350]).drawImage(image, { x: 0, y: 0, width: 700, height: 350 });
  }
  const open = async (name, bytes) => {
    await app.evaluate(({ BrowserWindow }, { name, bytes }) => BrowserWindow.getAllWindows()[0].webContents.send(
      "folio:open-file", { name, data: Buffer.from(bytes) }), { name, bytes: [...bytes] });
    await page.window.waitForFunction(name => document.title.startsWith(name), name);
  };
  await open("OCR search.pdf", await pdf.save());
  await page.locator('[data-page-number="1"] [data-ocr-word]').first().waitFor({ timeout: 45_000 });
  await page.keyboard.press("ControlOrMeta+f");
  const query = page.getByRole("textbox", { name: "Find in document" });
  const status = page.locator(".search-status");
  const search = async (text, expected) => {
    await query.fill(text);
    await query.press("Enter");
    try { await status.filter({ hasText: expected }).waitFor({ timeout: 45_000 }); }
    catch (error) {
      console.error(JSON.stringify({ query: text.slice(0, 80), expected, actual: await status.textContent(), errors, ocrWords: await page.locator('[data-ocr-word]').allTextContents() }));
      await page.screenshot({ path: path.join(shots, "ocr-search-failure.png") });
      throw error;
    }
  };
  await search("7319", "1 of 2");
  await page.getByRole("button", { name: "Go to page 4, 1 matches", exact: true }).waitFor();
  const snippet = page.locator(".search-results mark");
  assert.deepEqual(await snippet.allTextContents(), ["7319", "7319"]);
  await page.locator('[data-page-number="1"] [data-ocr-word] .highlight.selected').waitFor();
  await page.screenshot({ path: path.join(shots, "ocr-search.png") });
  await query.press("Enter");
  await status.filter({ hasText: "2 of 2" }).waitFor();
  assert.equal(await page.getByLabel("Page number").inputValue(), "4");
  await page.locator('[data-page-number="4"] [data-ocr-word] .highlight.selected').waitFor();
  await page.getByRole("button", { name: "Go to page 4, 1 matches", exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, "ocr-search-unvisited.png") });
  await query.press("Shift+Enter");
  await status.filter({ hasText: "1 of 2" }).waitFor();
  assert.equal(await page.getByLabel("Page number").inputValue(), "1");
  await search("AMBER RIVER", "1 of 1");
  assert.equal(await page.getByLabel("Page number").inputValue(), "3");
  assert.equal(await snippet.textContent(), "AMBER RIVER");
  // Cross-line and cross-word matches use exactly the same strings as PDF.js's highlighter.
  await search("8426 Total", "1 of 1");
  assert.equal(await snippet.textContent(), "8426 Total");
  await page.getByTitle(/^Zoom in/).click();
  await page.locator('[data-page-number="3"] [data-ocr-word] .highlight.selected').first().waitFor();
  await search("[not a regex]", "No results");
  await search("x".repeat(2000), "No results");
  await query.fill("");
  await page.waitForFunction(() => document.querySelector(".search-status")?.textContent === "");
  await page.getByLabel("Page number").fill("1");
  await page.getByLabel("Page number").press("Enter");
  await search("7319", "1 of 2");
  await page.getByTitle("Close (Esc)", { exact: true }).click();
  assert.equal(await page.locator(".textLayer .highlight").count(), 0);
  await page.keyboard.press("ControlOrMeta+f");
  await search("7319", "1 of 2");

  const native = await PDFDocument.create();
  const font = await native.embedFont(StandardFonts.Helvetica);
  native.addPage([700, 350]).drawText("Embedded 7319 and native text", { x: 40, y: 250, size: 24, font });
  await open("Native search.pdf", await native.save());
  await page.getByText("Embedded 7319 and native text", { exact: true }).waitFor();
  await page.keyboard.press("ControlOrMeta+f");
  await search("native text", "1 of 1");
  assert.equal(await snippet.textContent(), "native text");
  assert.equal(await page.locator("[data-ocr-word]").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Go to page 4, 1 matches", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await assertHidden(app);
  console.log("PASS OCR search: real image-only pages, unvisited pages, counts/snippets, selected highlights, next/previous, cross-line phrase, zoom, empty/literal/long input, close/reopen, native PDF and document isolation");
} catch (error) {
  console.error(JSON.stringify({ errors, page: await page?.getByLabel("Page number").inputValue().catch(() => ""), layers: await page?.locator('.textLayer').evaluateAll(layers => layers.map(layer => ({ page: layer.closest('[data-page-number]').dataset.pageNumber, html: layer.innerHTML.slice(0, 1400) }))).catch(() => []) }));
  await page?.screenshot({ path: path.join(shots, "ocr-search-failure.png") }).catch(() => {});
  throw error;
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
