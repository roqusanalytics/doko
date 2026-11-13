// Real OCR reaches the actual desktop AI request; only the remote provider is replaced.
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
const temp = mkdtempSync(path.join(tmpdir(), "doko-ocr-ai-"));
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
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of ["Embedded project: Baltic delivery", "Embedded city: Kaunas"]) {
    pdf.addPage([700, 1000]).drawText(text, { x: 40, y: 850, size: 24, font });
  }
  for (const text of ["AMBER RIVER 8426", "Reference code: 7319"]) {
    const png = await page.evaluate(text => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 1400, height: 2000 });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1400, 2000);
      ctx.fillStyle = "black"; ctx.font = "60px sans-serif";
      ctx.fillText(text, 70, 180);
      ctx.fillText("Total: 84.00 EUR", 70, 280);
      return canvas.toDataURL("image/png").split(",")[1];
    }, text);
    const image = await pdf.embedPng(Buffer.from(png, "base64"));
    pdf.addPage([700, 1000]).drawImage(image, { x: 0, y: 0, width: 700, height: 1000 });
  }
  await app.evaluate(({ BrowserWindow, net, safeStorage }, bytes) => {
    const fetch = net.fetch;
    const methods = ["isAsyncEncryptionAvailable", "encryptStringAsync", "decryptStringAsync"];
    if (process.platform === "linux") methods.push("getSelectedStorageBackend");
    const original = Object.fromEntries(methods.map(name => [name, safeStorage[name]]));
    safeStorage.isAsyncEncryptionAvailable = async () => true;
    if (process.platform === "linux") safeStorage.getSelectedStorageBackend = () => "gnome_libsecret";
    safeStorage.encryptStringAsync = async value => Buffer.from(value).map(b => b ^ 128);
    safeStorage.decryptStringAsync = async bytes => ({ result: Buffer.from(bytes).map(b => b ^ 128).toString() });
    const state = globalThis.ocrAiTest = { requests: [] };
    net.fetch = async (url, options) => {
      if (!String(url).startsWith("https://openrouter.ai/")) return fetch.call(net, url, options);
      if (options.headers.Authorization !== "Bearer fixture-only-openrouter-key") throw new Error("Unexpected fixture key");
      const endpoint = new URL(url).pathname;
      if (endpoint === "/api/v1/key") return Response.json({ data: { label: "Test" } });
      if (endpoint === "/api/v1/models") return Response.json({ data: [
        { id: "sample/reader", name: "Sample Reader", context_length: 131072, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      ] });
      if (endpoint !== "/api/v1/chat/completions") throw new Error("Unexpected OpenRouter endpoint");
      state.requests.push(JSON.parse(options.body));
      return new Response('data: {"choices":[{"delta":{"content":"The reference is 7319 (p. 4)."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    };
    state.restore = () => { net.fetch = fetch; Object.assign(safeStorage, original); };
    BrowserWindow.getAllWindows()[0].webContents.send("folio:open-file", { name: "Mixed OCR AI.pdf", data: Buffer.from(bytes) });
  }, [...await pdf.save()]);
  await page.window.waitForFunction(() => document.title.startsWith("Mixed OCR AI.pdf"));
  await page.getByText("Embedded project: Baltic delivery", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Page number").inputValue(), "1");
  assert.equal(await page.locator('[data-page-number="4"] [data-ocr-word]').count(), 0, "the scanned page must start unvisited");
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  await panel.getByRole("button", { name: "AI provider", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "OpenRouter", exact: true }).click();
  await panel.getByRole("button", { name: "Open Ask AI settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("API key", { exact: true }).fill("fixture-only-openrouter-key");
  await settings.getByRole("button", { name: "Verify and save" }).click();
  await settings.getByRole("searchbox", { name: "Model" }).fill("reader");
  await settings.getByRole("button", { name: /Sample Reader/ }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await panel.getByRole("textbox").fill("Read every page and find the reference code.");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.ocrAiTest.requests.length), 0, "Stop during preparation must not send the document");
  await panel.getByRole("textbox").fill("Try again: read every page and find the reference code.");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("button", { name: "(p. 4)", exact: true }).waitFor({ timeout: 90_000 });
  const requests = await app.evaluate(() => globalThis.ocrAiTest.requests);
  assert.equal(requests.length, 1, "only the retry may reach the provider");
  assert.equal(requests[0].model, "sample/reader");
  const document = JSON.parse(requests[0].messages[1].content).document;
  assert.equal(document.truncated, false);
  assert.match(document.text, /\[Page 1\]\nEmbedded project: Baltic delivery/);
  assert.match(document.text, /\[Page 2\]\nEmbedded city: Kaunas/);
  assert.match(document.text, /\[Page 3\]\n[^]*AMBER\s+RIVER\s+8426[^]*\[Page 4\]\n[^]*7319/);
  assert.equal(await page.getByLabel("Page number").inputValue(), "1", "whole-document OCR must not navigate away");
  await page.screenshot({ path: path.join(shots, "ocr-ai.png") });
  await panel.getByRole("button", { name: "(p. 4)", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === "4");
  await page.locator('[data-page-number="4"] [data-ocr-word]').first().waitFor({ timeout: 30_000 });
  assert.deepEqual(errors, []);
  await assertHidden(app);
  console.log("PASS OCR AI: real OCR on unvisited image-only pages, embedded text, page labels in actual provider request, Stop during preparation, retry, citation navigation; no real provider credentials/network");
} catch (error) {
  console.error(JSON.stringify({ errors, requests: await app.evaluate(() => globalThis.ocrAiTest?.requests.length).catch(() => null) }));
  await page?.screenshot({ path: path.join(shots, "ocr-ai-failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(() => { globalThis.ocrAiTest?.restore(); delete globalThis.ocrAiTest; }).catch(() => {});
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
