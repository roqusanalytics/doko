// Ending an Ask AI answer before its first word: Stop, or closing the panel, must not leave an empty answer that
// shows "Thinking" forever. Only the remote provider is replaced; it holds every answer open until it is cancelled.
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
const temp = mkdtempSync(path.join(tmpdir(), "doko-ai-end-"));
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
  pdf.addPage([600, 800]).drawText("Delivery city: Kaunas", { x: 40, y: 700, size: 24, font });
  await app.evaluate(({ BrowserWindow, net, safeStorage }, bytes) => {
    const fetch = net.fetch;
    const methods = ["isAsyncEncryptionAvailable", "encryptStringAsync", "decryptStringAsync"];
    if (process.platform === "linux") methods.push("getSelectedStorageBackend");
    const original = Object.fromEntries(methods.map(name => [name, safeStorage[name]]));
    safeStorage.isAsyncEncryptionAvailable = async () => true;
    if (process.platform === "linux") safeStorage.getSelectedStorageBackend = () => "gnome_libsecret";
    safeStorage.encryptStringAsync = async value => Buffer.from(value).map(b => b ^ 128);
    safeStorage.decryptStringAsync = async bytes => ({ result: Buffer.from(bytes).map(b => b ^ 128).toString() });
    const state = globalThis.aiEndTest = { requests: 0, cancelled: 0 };
    net.fetch = async (url, options) => {
      if (!String(url).startsWith("https://openrouter.ai/")) return fetch.call(net, url, options);
      const endpoint = new URL(url).pathname;
      if (endpoint === "/api/v1/key") return Response.json({ data: { label: "Test" } });
      if (endpoint === "/api/v1/models") return Response.json({ data: [
        { id: "sample/reader", name: "Sample Reader", context_length: 131072, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      ] });
      state.requests++;
      // No word ever arrives; the stream only ends when Doko cancels the answer.
      return new Response(new ReadableStream({ start(controller) {
        options.signal?.addEventListener("abort", () => { state.cancelled++; controller.error(options.signal.reason); }, { once: true });
      } }));
    };
    state.restore = () => { net.fetch = fetch; Object.assign(safeStorage, original); };
    BrowserWindow.getAllWindows()[0].webContents.send("folio:open-file", { name: "Ending answers.pdf", data: Buffer.from(bytes) });
  }, [...await pdf.save()]);
  await page.window.waitForFunction(() => document.title.startsWith("Ending answers.pdf"));
  await page.getByText("Delivery city: Kaunas", { exact: true }).waitFor();

  const askAi = page.getByRole("button", { name: "Ask AI", exact: true });
  await askAi.click();
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

  const thinking = panel.getByLabel("Thinking");
  const ask = async (question, requests) => {
    await panel.getByRole("textbox").fill(question);
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    await app.evaluate(async count => {
      while (globalThis.aiEndTest.requests < count) await new Promise(resolve => setTimeout(resolve, 50));
    }, requests);
    await thinking.waitFor();
  };
  const cancelled = count => app.evaluate(async count => {
    while (globalThis.aiEndTest.cancelled < count) await new Promise(resolve => setTimeout(resolve, 50));
  }, count);

  // 1. Stop before the first word.
  await ask("Which city is it?", 1);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await cancelled(1);
  await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await thinking.count(), 0, "Stop before the first word must not leave Thinking showing");

  // 2. Close the panel before the first word, then open it again.
  await ask("And the delivery city again?", 2);
  await askAi.click();
  await cancelled(2);
  await askAi.click();
  await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await thinking.count(), 0, "closing before the first word must not reopen with Thinking showing");

  assert.deepEqual(errors, []);
  await assertHidden(app);
  console.log("PASS Ask AI request end: Stop and closing the panel before the first word leave no endless Thinking");
} catch (error) {
  console.error(error);
  await page?.screenshot({ path: path.join(shots, "ai-request-end-failure.png"), timeout: 10_000 }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(() => { globalThis.aiEndTest?.restore(); delete globalThis.aiEndTest; }).catch(() => {});
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
