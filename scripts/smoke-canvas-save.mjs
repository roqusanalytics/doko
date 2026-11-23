// Use the real reader, native menu and filesystem with a disposable profile and mocked OS dialogs.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-canvas-save-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };

delete env.ELECTRON_RUN_AS_NODE;

const lightPath = path.join(temp, "light.excalidraw");
const darkPath = path.join(temp, "dark.excalidraw");
const corruptPath = path.join(temp, "corrupt.excalidraw");
const readScene = file => JSON.parse(readFileSync(file, "utf8"));

const wait = async (condition, failure) => {
  const end = Date.now() + 10_000;

  while (Date.now() < end) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error(failure);
};

const sceneContents = scene => scene.elements.map(element => ({
  id: element.id, type: element.type, text: element.text, container: element.containerId,
  start: element.startBinding, end: element.endBinding, bound: element.boundElements ?? [],
  position: [element.x, element.y, element.width, element.height, element.angle],
  stroke: element.strokeColor, fill: element.backgroundColor, fileId: element.fileId,
}));

let app;

try {
  app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio",
    ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
  const window = await app.firstWindow();
  window.setDefaultTimeout(10_000);
  const page = readerPage(window);
  const errors = [];
  window.on("pageerror", error => errors.push(error.message));
  const welcome = page.getByRole("button", { name: "New canvas", exact: true });
  await welcome.waitFor({ timeout: 30_000 });

  const setTheme = async name => {
    await page.keyboard.press("ControlOrMeta+,");
    await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("radio", { name, exact: true }).click();
    await page.keyboard.press("Escape");
  };

  await setTheme("Light");

  await app.evaluate(({ dialog }, paths) => {
    globalThis.canvasDocumentDialogs = { saves: [], errors: [] };
    const destinations = [paths.lightPath, paths.darkPath];
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.canvasDocumentDialogs.saves.push(options);
      const filePath = destinations.shift();

      if (!filePath) throw new Error("Unexpected Save dialog");

      return { canceled: false, filePath };
    };

    dialog.showOpenDialog = async (_window, options) => {
      globalThis.canvasDocumentDialogs.open = options;

      return { canceled: false, filePaths: [paths.lightPath] };
    };

    dialog.showErrorBox = (title, detail) => globalThis.canvasDocumentDialogs.errors.push({ title, detail });
  }, { lightPath, darkPath });

  const menuState = () => app.evaluate(({ Menu }) => Object.fromEntries(
    Menu.getApplicationMenu().items.find(item => item.label === "File").submenu.items
      .filter(item => item.label).map(item => [item.label, item.enabled])));

  const native = async label => {
    await wait(async () => (await menuState())[label], `File/${label} is unavailable`);
    await app.evaluate(({ Menu, BrowserWindow }, label) => {
      const item = Menu.getApplicationMenu().items.find(item => item.label === "File").submenu.items.find(item => item.label === label);
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    }, label);
  };

  const tab = name => page.getByRole("tab", { name, exact: true, selected: true });
  const editor = page.locator(".excalidraw");
  const surface = page.locator("canvas.excalidraw__canvas.interactive");

  const waitForImage = () => page.waitForFunction(() => {
    const surface = document.querySelector("canvas.excalidraw__canvas.static");

    if (!surface?.width || !surface.height) return false;
    const rgba = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data;

    for (let offset = 0; offset < rgba.length; offset += 4) {
      if (rgba[offset] === 237 && rgba[offset + 1] === 39 && rgba[offset + 2] === 119 && rgba[offset + 3] === 255) return true;
    }

    return false;
  });

  await welcome.click();
  await surface.waitFor();
  await wait(async () => (await menuState())["Save"], "Canvas did not activate the native File menu");
  const menu = await menuState();

  for (const name of ["Save", "Save As…", "Properties…", "Export / Convert…"]) assert.equal(menu[name], true, name);

  for (const name of ["Print…", "Reduce File Size…"]) assert.equal(menu[name], false, name);
  assert.equal(await editor.evaluate(element => element.classList.contains("theme--dark")), false);

  const bounds = await surface.boundingBox();
  const x = bounds.x + bounds.width * 0.45, y = bounds.y + bounds.height * 0.42;
  await page.mouse.click(x, y);
  await page.evaluate(() => {
    const imageSurface = Object.assign(document.createElement("canvas"), { width: 60, height: 40 });
    const context = imageSurface.getContext("2d");
    context.fillStyle = "#ed2777";
    context.fillRect(0, 0, 60, 40);
    const id = "canvas-document-image";
    const data = new DataTransfer();
    data.setData("text/plain", JSON.stringify({
      type: "excalidraw-api/clipboard",
      elements: [
        { type: "rectangle", id: "start", x: 0, y: 0, width: 130, height: 65, strokeColor: "#e03131", label: { text: "Before" } },
        { type: "ellipse", id: "end", x: 220, y: 0, width: 130, height: 65, backgroundColor: "#b2f2bb", label: { text: "After" } },
        { type: "arrow", x: 140, y: 30, width: 70, height: 1, start: { id: "start" }, end: { id: "end" } },
        { type: "image", x: 155, y: 100, width: 60, height: 40, fileId: id, status: "saved" },
      ],
      files: { [id]: { id, dataURL: imageSurface.toDataURL(), mimeType: "image/png", created: 1 } },
    }));
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  await waitForImage();
  const properties = page.getByRole("dialog", { name: "Properties" });
  await native("Properties…");
  await properties.getByText("6", { exact: true }).waitFor();
  await properties.getByRole("button", { name: "Close", exact: true }).click();

  await page.keyboard.press("ControlOrMeta+s");
  await tab("light.excalidraw").waitFor();
  const first = readScene(lightPath);
  assert.deepEqual(Object.keys(first).sort(), ["appState", "elements", "files", "source", "type", "version"]);
  assert.equal(first.type, "excalidraw");
  assert.equal(first.version, 2);
  assert.equal(typeof first.source, "string");
  assert.deepEqual(Object.keys(first.appState).sort(), ["gridModeEnabled", "gridSize", "gridStep", "viewBackgroundColor"]);
  assert.deepEqual(first.elements.map(element => element.type).sort(), ["arrow", "ellipse", "image", "rectangle", "text", "text"]);
  assert.deepEqual(first.elements.filter(element => element.type === "text").map(element => element.text).sort(), ["After", "Before"]);
  const arrow = first.elements.find(element => element.type === "arrow");
  assert.equal(arrow.startBinding?.elementId, first.elements.find(element => element.type === "rectangle").id);
  assert.equal(arrow.endBinding?.elementId, first.elements.find(element => element.type === "ellipse").id);
  const image = first.elements.find(element => element.type === "image");
  assert.match(first.files[image.fileId].dataURL, /^data:image\/png;base64,/);

  const draw = async (tool, left, top) => {
    await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: tool, exact: true }).click();
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(left + 65, top + 55, { steps: 5 });
    await page.mouse.up();
  };

  await draw("Diamond", x - 110, y + 40);
  await wait(() => readScene(lightPath).elements.length === 7, "Canvas changes did not autosave");
  assert.ok(readScene(lightPath).elements.some(element => element.type === "diamond"));

  await draw("Ellipse", x + 20, y + 55);
  await native("Close Tab");
  await welcome.waitFor();
  const autosaved = readScene(lightPath);
  assert.equal(autosaved.elements.length, 8, "Closing the tab lost the last edit");
  await native("Open…");
  await tab("light.excalidraw").waitFor();
  await surface.waitFor();
  await waitForImage();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await welcome.waitFor();
  await setTheme("Dark");
  await page.getByRole("tab", { name: "light.excalidraw", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".excalidraw")?.classList.contains("theme--dark"));
  await native("Save As…");
  await tab("dark.excalidraw").waitFor();
  const dark = readScene(darkPath);
  assert.deepEqual(sceneContents(dark), sceneContents(autosaved), "Reopening in dark theme changed elements, styles, labels, or bindings");
  assert.deepEqual(dark.files, autosaved.files);
  assert.deepEqual(dark.appState, autosaved.appState);
  assert.deepEqual(readScene(lightPath), autosaved, "Save As changed the original");

  // Drop a disk-backed File, preserving the real preload path lookup. The current scene should stay open.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "canvas-document-drop-fixture";
    input.hidden = true;
    document.body.append(input);
  });
  const input = page.locator("#canvas-document-drop-fixture");
  await input.setInputFiles(lightPath);
  await input.evaluate(element => {
    const data = new DataTransfer();
    data.items.add(element.files[0]);
    document.querySelector("canvas.excalidraw__canvas.interactive").dispatchEvent(new DragEvent("drop", {
      dataTransfer: data, bubbles: true, cancelable: true,
    }));
    element.remove();
  });
  await tab("light.excalidraw").waitFor();
  await surface.waitFor();
  assert.equal(await page.getByRole("tab", { name: "dark.excalidraw", exact: true }).count(), 1);

  writeFileSync(corruptPath, "{broken");
  const openFileEvent = file => app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  await openFileEvent(corruptPath);
  await wait(async () => (await app.evaluate(() => globalThis.canvasDocumentDialogs.errors)).length === 1, "Corrupt file did not show an error");
  const dialogs = await app.evaluate(() => globalThis.canvasDocumentDialogs);
  assert.match(dialogs.errors[0].detail, /invalid JSON/);
  assert.ok(dialogs.open.filters.some(filter => filter.extensions.includes("excalidraw")));
  assert.deepEqual(dialogs.saves.map(save => [save.defaultPath, save.filters[0].extensions]),
    [["Untitled Canvas.excalidraw", ["excalidraw"]], ["light.excalidraw", ["excalidraw"]]]);
  await native("Close Tab");
  await openFileEvent(lightPath);
  await tab("light.excalidraw").waitFor();
  await surface.waitFor();
  await native("Open Recent…");
  await welcome.waitFor();
  assert.equal(await page.locator(".recent-card").count(), 0, "Canvas files appeared in Recent");

  assert.deepEqual(errors, []);
  await assertHidden(app);
  console.log("PASS Canvas Save, autosave, Save As, reopen by Open/drop/OS event, image and bindings round-trip, theme, corrupt-file error, and Recent exclusion");
} finally {
  if (app) await closeHidden(app);
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
