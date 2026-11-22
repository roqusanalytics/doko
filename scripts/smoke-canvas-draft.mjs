import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-canvas-draft-"));
const saved = path.join(temp, "draft-saved.excalidraw");
const savedOnClose = path.join(temp, "draft-saved-on-close.excalidraw");
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;

const drafts = async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("folio");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(["canvas-document-draft", ""], ["canvas-document-draft", "\uffff"]);
      const request = db.transaction("versionPdfs").objectStore("versionPdfs").getAll(range);
      request.onsuccess = () => resolve(request.result.map(text => JSON.parse(text)));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
};

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
  const surface = page.locator("canvas.excalidraw__canvas.interactive");
  const draftTab = page.getByRole("tab", { name: "Untitled Canvas", exact: true });
  const dirtyClose = page.getByRole("button", { name: "Close Untitled Canvas, unsaved changes", exact: true });
  const prompt = page.getByRole("dialog", { name: "Save?", exact: true });
  const wait = async (condition, failure) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(failure);
  };
  const native = label => wait(() => app.evaluate(({ Menu, BrowserWindow }, label) => {
    const item = Menu.getApplicationMenu().items.find(item => item.label === "File")
      .submenu.items.find(item => item.label === label);
    if (!item?.enabled) return false;
    item.click(item, BrowserWindow.getAllWindows()[0], {});
    return true;
  }, label), `File/${label} is unavailable`);
  const draw = async (tool, offset = 0) => {
    const bounds = await surface.boundingBox();
    const x = bounds.x + bounds.width * 0.38 + offset, y = bounds.y + bounds.height * 0.45;
    await page.locator(`label:has([data-testid="toolbar-${tool}"])`).click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 65, y + 55, { steps: 5 });
    await page.mouse.up();
  };
  const assertElements = async count => {
    await surface.waitFor();
    const properties = page.getByRole("dialog", { name: "Properties", exact: true });
    await native("Properties…");
    await properties.getByText(String(count), { exact: true }).waitFor();
    await properties.getByRole("button", { name: "Close", exact: true }).click();
  };
  const suspendActiveTab = async () => {
    const key = await page.evaluate(() => {
      const { tabs, key } = window.frameElement.readerContext;
      window.parent.canvasDraftTabs = tabs;
      return key;
    });
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await welcome.waitFor();
    assert.equal(await window.evaluate(async key => {
      const tabs = window.canvasDraftTabs;
      const tab = tabs.all.find(tab => tab.key === key);
      if (tab.suspendTimer === undefined) throw new Error("Canvas tab did not schedule suspension");
      await tabs.suspend(tab);
      return !tab.frame && !tab.reader;
    }, key), true, "Canvas reader stayed live");
  };
  const waitForDraft = count => wait(async () => {
    const records = await window.evaluate(drafts);
    return records.length === 1 && records[0].elements.length === count;
  }, `No draft with ${count} elements`);

  await welcome.waitFor({ timeout: 30_000 });
  await app.evaluate(({ dialog }, destinations) => {
    globalThis.canvasDraftDialogPaths = [];
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.canvasDraftDialogPaths.push(options.defaultPath);
      if (!destinations.length) throw new Error("Unexpected Save dialog");
      const filePath = destinations.shift();
      return filePath ? { canceled: false, filePath } : { canceled: true };
    };
    dialog.showMessageBox = async (_window, options) => {
      if (options.buttons[0] !== "Reload Doko") throw new Error("Unexpected message box");
      return { response: 0 };
    };
  }, [null, saved, savedOnClose]);
  await welcome.click();
  await surface.waitFor();
  await draw("rectangle");
  await waitForDraft(1);
  await page.evaluate(() => {
    document.documentElement.dataset.beforeCanvasReload = "yes";
    window.location.reload();
  });
  await window.waitForFunction(() => !document.querySelector("iframe.active")?.contentDocument?.documentElement
    ?.hasAttribute("data-before-canvas-reload"));
  await assertElements(1);

  await draw("ellipse", 100);
  await suspendActiveTab();
  await waitForDraft(2);
  await dirtyClose.click();
  await prompt.getByRole("button", { name: "Cancel", exact: true }).click();
  await prompt.waitFor({ state: "hidden" });
  assert.equal(await draftTab.getAttribute("aria-selected"), "true");
  await assertElements(2);

  const beforeSave = (await window.evaluate(drafts))[0];
  await page.keyboard.press("ControlOrMeta+s");
  await wait(() => app.evaluate(() => globalThis.canvasDraftDialogPaths.length === 1), "Save shortcut didn't open the file picker");
  assert.deepEqual((await window.evaluate(drafts))[0], beforeSave, "Canceling the file picker lost the draft");
  await native("Save");
  const savedTab = page.getByRole("tab", { name: path.basename(saved), exact: true, selected: true });
  await savedTab.waitFor();
  assert.deepEqual(await window.evaluate(drafts), [], "First Save left a draft");
  const read = file => JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(read(saved).elements.map(element => element.id), beforeSave.elements.map(element => element.id));

  await draw("diamond", 200);
  await suspendActiveTab();
  assert.deepEqual(read(saved).elements.map(element => element.type), ["rectangle", "ellipse", "diamond"]);
  await page.getByRole("tab", { name: path.basename(saved), exact: true }).click();
  await assertElements(3);

  await native("New Canvas");
  await surface.waitFor();
  await draw("rectangle");
  await waitForDraft(1);
  await dirtyClose.click();
  await prompt.getByRole("button", { name: "Don't save", exact: true }).click();
  await draftTab.waitFor({ state: "hidden" });
  assert.deepEqual(await window.evaluate(drafts), [], "Don't save left a draft");

  await native("New Canvas");
  await surface.waitFor();
  await draw("ellipse");
  await dirtyClose.click();
  await prompt.getByRole("button", { name: "Save", exact: true }).click();
  await draftTab.waitFor({ state: "hidden" });
  assert.equal(read(savedOnClose).elements[0].type, "ellipse");
  assert.deepEqual(await window.evaluate(drafts), []);
  assert.deepEqual(await app.evaluate(() => globalThis.canvasDraftDialogPaths), Array(3).fill("Untitled Canvas.excalidraw"));
  assert.deepEqual(errors, []);

  await native("New Canvas");
  await surface.waitFor();
  await draw("diamond");
  await waitForDraft(1);
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const webContents = BrowserWindow.getAllWindows()[0].webContents;
    webContents.once("did-finish-load", () => resolve());
    webContents.forcefullyCrashRenderer();
  }));
  // Playwright retains the crashed target. Inspect the new renderer from the main process.
  await wait(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`
    (() => {
      const reader = document.querySelector("iframe.document-reader.active")?.contentDocument;
      const selected = reader?.querySelector('[role="tab"][aria-selected="true"]');
      return selected?.ariaLabel === "Untitled Canvas" &&
        !!reader.querySelector('[aria-label="Close Untitled Canvas, unsaved changes"]') &&
        !!reader.querySelector("canvas.excalidraw__canvas.interactive");
    })()
  `)), "Doko did not reopen the draft after the renderer crashed");
  await assertHidden(app);
  console.log("PASS Canvas draft survives reader reload and renderer crash, Save and discard remove it, Cancel retains the tab, and draft/file suspension keeps the latest edit");
} finally {
  if (app) await closeHidden(app);
  await rm(temp, { recursive: true, force: true, maxRetries: 5 });
}
