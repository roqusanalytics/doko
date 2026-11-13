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
  // Keep preparation pending so Stop is exercised before a fast OCR run reaches the provider.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.action !== "recognize") return post.call(this, message, ...rest);
      Worker.prototype.postMessage = post;
      window.resumeOcrPreparation = () => post.call(this, message, ...rest);
    };
  });
  await panel.getByRole("textbox").fill("Read every page and find the reference code.");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => !!window.resumeOcrPreparation);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.ocrAiTest.requests.length), 0, "Stop during preparation must not send the document");
  await page.evaluate(() => { window.resumeOcrPreparation(); delete window.resumeOcrPreparation; });
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
  // A fresh document leaves its scans unvisited so the failure occurs during AI preparation.
  await page.window.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.action !== "recognize") return post.call(this, message, ...rest);
      Worker.prototype.postMessage = post;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: { action: "recognize", jobId: message.jobId, status: "reject", data: "Synthetic OCR preparation failure" },
      })));
    };
  });
  pdf.setTitle("OCR retry history fixture");
  await app.evaluate(({ BrowserWindow }, bytes) => BrowserWindow.getAllWindows()[0].webContents.send(
    "folio:open-file", { name: "OCR retry history.pdf", data: Buffer.from(bytes) }), [...await pdf.save()]);
  await page.window.waitForFunction(() => document.title.startsWith("OCR retry history.pdf"));
  await page.getByText("Embedded project: Baltic delivery", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const question = "Read every page and find the reference code.";
  await panel.getByRole("textbox").fill(question);
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByText("Doko couldn’t read this document. Your question is below; send it again to retry.", { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.ocrAiTest.requests.length), 1, "failed preparation must not reach the provider");
  assert.equal(await panel.getByRole("textbox").inputValue(), question);
  assert.equal(await panel.locator(".msg.user").count(), 0, "failed preparation must return its question to the input, not leave a history turn");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("button", { name: "(p. 4)", exact: true }).waitFor({ timeout: 90_000 });
  assert.equal(await panel.locator(".msg.user").count(), 1, "retry must leave one visible question");
  const retried = await app.evaluate(() => globalThis.ocrAiTest.requests.at(-1));
  const sentUsers = retried.messages.filter(message => message.role === "user");
  assert.equal(JSON.parse(sentUsers[0].content).document.name, "OCR retry history.pdf");
  assert.deepEqual(sentUsers.slice(1).map(message => message.content), [question]);
  await page.screenshot({ path: path.join(shots, "ocr-ai-retry-history.png") });
  await panel.getByRole("button", { name: "Close Ask AI", exact: true }).click();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await panel.getByText(question, { exact: true }).waitFor();
  assert.equal(await panel.locator(".msg.user").count(), 1, "reopening must not restore a failed duplicate");
  await page.waitForFunction(async question => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("folio");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const files = await new Promise((resolve, reject) => {
        const request = db.transaction("recent").objectStore("recent").getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const id = files.find(file => file.name === "OCR retry history.pdf")?.id;
      if (!id) return false;
      const chat = await new Promise((resolve, reject) => {
        const request = db.transaction("ai").objectStore("ai").get(id);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      return chat?.messages.filter(message => message.role === "user" && message.content === question).length === 1;
    } finally { db.close(); }
  }, question);
  await panel.getByRole("textbox").fill(question);
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("button", { name: "(p. 4)", exact: true }).nth(1).waitFor();
  assert.equal(await panel.locator(".msg.user").count(), 2, "a deliberate repeat after a successful answer remains a new turn");
  assert.deepEqual(errors, []);
  await assertHidden(app);
  console.log("PASS OCR AI: real OCR, Stop/retry, citations; preparation failure restores input without duplicate visible/provider/reopened history; successful repeat retained; no real provider credentials/network");
} catch (error) {
  console.error(error);
  console.error(JSON.stringify({ errors, requests: await app.evaluate(() => globalThis.ocrAiTest?.requests.length).catch(() => null) }));
  await page?.screenshot({ path: path.join(shots, "ocr-ai-failure.png"), timeout: 10_000 }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(() => { globalThis.ocrAiTest?.restore(); delete globalThis.ocrAiTest; }).catch(() => {});
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
