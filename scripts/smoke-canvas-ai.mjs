// Run after npm run build. Use the real Canvas, renderer, IPC and SSE reader with a local response.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-canvas-ai-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio",
  ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });

try {
  const window = await app.firstWindow();
  window.setDefaultTimeout(10_000);
  const page = readerPage(window);
  await page.getByRole("button", { name: "New canvas", exact: true }).click({ timeout: 30_000 });
  const surface = page.locator("canvas.excalidraw__canvas.interactive");
  await surface.waitFor();
  await page.evaluate(() => {
    // Inspect the editor through its scene getter without adding a production test hook.
    globalThis.readCanvasAiScene = () => {
      const node = document.querySelector(".excalidraw");
      const fiberKey = Object.keys(node).find(key => key.startsWith("__reactFiber$"));
      for (let fiber = node[fiberKey]; fiber; fiber = fiber.return) {
        const editor = fiber.stateNode;
        if (typeof editor?.getSceneElements === "function") {
          return { elements: editor.getSceneElements(), selected: Object.keys(editor.state.selectedElementIds) };
        }
      }
      throw new Error("Canvas editor unavailable");
    };
  });
  const scene = () => page.evaluate(() => globalThis.readCanvasAiScene());
  await app.evaluate(({ net, safeStorage }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true;
    if (process.platform === "linux") safeStorage.getSelectedStorageBackend = () => "gnome_libsecret";
    safeStorage.encryptStringAsync = async value => Buffer.from(value);
    safeStorage.decryptStringAsync = async bytes => ({ result: Buffer.from(bytes).toString() });
    const originalFetch = net.fetch;
    const state = globalThis.canvasDocumentRouterTest = { requests: [], cancelled: false };
    net.fetch = async (url, options) => {
      if (!String(url).startsWith("https://openrouter.ai/")) return originalFetch.call(net, url, options);
      if (options.headers.Authorization !== "Bearer fixture-only-canvas-key") return new Response(null, { status: 401 });
      const endpoint = new URL(url).pathname;
      if (endpoint === "/api/v1/key") return Response.json({ data: { label: "Test" } });
      if (endpoint === "/api/v1/models") return Response.json({ data: [
        { id: "sample/draw", name: "Sample Draw", context_length: 131072, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      ] });
      if (endpoint !== "/api/v1/chat/completions") throw new Error("Unexpected OpenRouter endpoint");
      const request = JSON.parse(options.body);
      state.requests.push(request);
      const question = request.messages.at(-1).content;
      const document = JSON.parse(request.messages[1].content).document;
      const existing = document.text.split("\n").map(line => JSON.parse(line)).find(row => row.selected)?.id;
      const elements = [
        { type: "rectangle", id: "new-box", x: 0, y: 0, width: 120, height: 50, label: { text: "Review" } },
        { type: "arrow", x: -90, y: 25, points: [[0, 0], [90, 0]], start: { id: existing }, end: { id: "new-box" } },
      ];
      const broken = question === "Draw a broken reply";
      const text = (broken ? "Drawing a bad reply." : question === "Draw and cancel" ? "Cancelled drawing." : "Added a review step.")
        + "\n```excalidraw\n" + (broken ? "[broken" : JSON.stringify(elements)) + "\n```";
      const sse = value => new TextEncoder().encode("data: " + value + "\n\n");
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(sse(JSON.stringify({ choices: [{ delta: { content: text } }] })));
        state.finish = () => { controller.enqueue(sse("[DONE]")); controller.close(); };
        options.signal.addEventListener("abort", () => { state.cancelled = true; controller.error(new Error("Stopped")); }, { once: true });
        if (broken) state.finish();
      } }));
    };
  });

  const toggle = page.getByRole("button", { name: "Ask AI", exact: true });
  await toggle.click();
  const panel = page.getByRole("complementary", { name: "Ask AI" });
  await panel.getByRole("button", { name: "AI provider", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "OpenRouter", exact: true }).click();
  await panel.getByRole("button", { name: "Open Ask AI settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("API key", { exact: true }).fill("fixture-only-canvas-key");
  await settings.getByRole("button", { name: "Verify and save" }).click();
  await settings.getByRole("button", { name: /Sample Draw/ }).click();
  await settings.getByRole("button", { name: "Close", exact: true }).click();

  const bounds = await surface.boundingBox();
  assert.ok(bounds && bounds.width > 350 && bounds.height > 200);
  const x = bounds.x + bounds.width * 0.3, y = bounds.y + bounds.height * 0.45;
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 65, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => globalThis.readCanvasAiScene().selected.length === 1);
  const before = await scene();
  assert.equal(before.elements.length, 1);
  assert.equal(before.elements[0].id, before.selected[0]);

  const send = async question => {
    await panel.getByRole("textbox").fill(question);
    await panel.getByRole("button", { name: "Send", exact: true }).click();
  };
  await send("Add a review step");
  await panel.getByText("Added a review step.", { exact: true }).waitFor();
  assert.deepEqual(await scene(), before, "A partial answer changed the Scene");
  assert.equal(await panel.locator("pre").count(), 0, "Drawing JSON appeared in chat");
  const request = await app.evaluate(() => globalThis.canvasDocumentRouterTest.requests[0]);
  assert.match(request.messages[0].content, /Element skeletons/);
  assert.equal(request.model, "sample/draw");
  const sentDocument = JSON.parse(request.messages[1].content).document;
  assert.equal(sentDocument.kind, "canvas");
  const [sent] = sentDocument.text.split("\n").map(JSON.parse);
  assert.equal(sent.id, before.elements[0].id);
  assert.equal(sent.selected, true);
  await app.evaluate(() => globalThis.canvasDocumentRouterTest.finish());
  await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
  const after = await scene();
  assert.deepEqual(after.elements[0], before.elements[0]);
  const added = after.elements.slice(1);
  assert.deepEqual(added.map(element => element.type).sort(), ["arrow", "rectangle", "text"]);
  const review = added.find(element => element.type === "rectangle");
  const arrow = added.find(element => element.type === "arrow");
  const label = added.find(element => element.type === "text");
  assert.ok(review.x > before.elements[0].x + before.elements[0].width);
  assert.equal(label.text, "Review");
  assert.equal(label.containerId, review.id);
  assert.equal(arrow.startBinding.elementId, before.selected[0]);
  assert.equal(arrow.endBinding.elementId, review.id);
  assert.deepEqual(new Set(after.selected), new Set(added.map(element => element.id)));
  assert.equal(await panel.locator("pre").count(), 0);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(() => globalThis.readCanvasAiScene().elements.length === 1);
  assert.deepEqual((await scene()).elements, before.elements);

  await send("Draw a broken reply");
  await panel.getByRole("alert").filter({ hasText: "invalid JSON" }).waitFor();
  assert.deepEqual((await scene()).elements, before.elements);

  await send("Draw and cancel");
  await panel.getByText("Cancelled drawing.", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByRole("button", { name: "Send", exact: true }).waitFor();
  for (let i = 0; i < 100 && !(await app.evaluate(() => globalThis.canvasDocumentRouterTest.cancelled)); i++) {
    await page.waitForTimeout(25);
  }
  assert.ok(await app.evaluate(() => globalThis.canvasDocumentRouterTest.cancelled), "Stop did not abort the provider");
  assert.deepEqual((await scene()).elements, before.elements);

  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    const name = databases.find(db => db.name === "folio")?.name;
    if (!name) return false;
    const stored = await new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction("ai", "readonly").objectStore("ai").getAll();
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = () => { db.close(); resolve(read.result); };
      };
    });
    return stored.some(chat => chat.messages.some(message => message.content === "Added a review step."));
  });
  await panel.getByRole("button", { name: "Close Ask AI", exact: true }).click();
  await toggle.click();
  await panel.getByText("Add a review step", { exact: true }).waitFor();
  await panel.getByText("Added a review step.", { exact: true }).waitFor();
  assert.equal(await panel.getByText("Cancelled drawing.", { exact: true }).count(), 0);
  assert.deepEqual((await scene()).elements, before.elements, "Reopening chat applied an old drawing");
  await assertHidden(app);
  console.log("PASS Canvas Ask AI streamed, inserted and selected a drawing; Undo, validation, Stop and persisted history worked");
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
