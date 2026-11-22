import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-welcome-cards-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
/** @type {[string, string[]][]} */
const formats = [
  ["PDF", ["pdf"]],
  ["Markdown", ["md", "markdown"]],
  ["Photos", ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]],
  ["Excel", ["xlsx", "xls"]],
  ["Word", ["doc", "docx"]],
];
const allExtensions = ["pdf", "doc", "docx", "xlsx", "xls", "md", "markdown", "txt", "csv", "svg", "html", "htm",
  "excalidraw", "jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];
let app;
try {
  app = await electron.launch({ executablePath: electronPath(env), args: [root, "--mute-audio",
    ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], env });
  const window = await app.firstWindow();
  window.setDefaultTimeout(15_000);
  const page = readerPage(window);
  const group = page.getByRole("group", { name: "Document types" });
  const button = name => group.getByRole("button", { name, exact: true });
  const dropzone = page.getByRole("button", { name: /^Open a file/ });
  await dropzone.waitFor();
  await assertHidden(app);
  assert.equal(await group.getByRole("button").count(), 6);

  for (const [width, columns] of [[1120, 6], [580, 3], [440, 2]]) {
    await window.setViewportSize({ width, height: 760 });
    const tracks = await group.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").map(parseFloat));
    assert.equal(tracks.length, columns, `width ${width}`);
    assert.ok(Math.max(...tracks) - Math.min(...tracks) < 0.1, "every column is the same width");
  }

  await dropzone.focus();
  for (const name of ["New canvas", ...formats.map(([name]) => name)]) {
    await window.keyboard.press("Tab");
    const focus = await button(name).evaluate(element => ({
      focused: element === document.activeElement,
      visible: element.matches(":focus-visible"),
      width: getComputedStyle(element).outlineWidth,
    }));
    assert.deepEqual(focus, { focused: true, visible: true, width: "2px" }, `${name} has keyboard focus`);
  }
  console.log("PASS six accessible Welcome cards, equal columns at three widths, and visible keyboard focus");

  await app.evaluate(({ dialog }) => {
    globalThis.openDialogCalls = [];
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.openDialogCalls.push(options);
      return { canceled: true, filePaths: [] };
    };
  });
  for (const [index, [name, extensions]] of formats.entries()) {
    await button(name).click();
    const deadline = Date.now() + 5_000;
    let calls = await app.evaluate(() => globalThis.openDialogCalls);
    while (calls.length <= index && Date.now() < deadline) {
      await delay(25);
      calls = await app.evaluate(() => globalThis.openDialogCalls);
    }
    assert.equal(calls.length, index + 1, `${name} opens one dialog`);
    assert.deepEqual(calls[index].filters, [{ name, extensions }, { name: "All supported files", extensions: allExtensions }]);
    assert.deepEqual(calls[index].properties, ["openFile", "multiSelections"]);
  }
  await assert.rejects(page.evaluate(() => window.folioDesktop.openFiles("invalid")), /Unsupported file type/);
  assert.equal(await app.evaluate(() => globalThis.openDialogCalls.length), formats.length);
  console.log("PASS five native dialog filters with the full list as fallback, and invalid filters rejected");

  await button("New canvas").focus();
  await window.keyboard.press("Enter");
  await page.getByRole("tab", { name: "Untitled Canvas", exact: true }).waitFor();
  await page.locator(".excalidraw").waitFor();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await dropzone.waitFor();
  const markdownPath = path.join(temp, "Welcome example.md");
  writeFileSync(markdownPath, "# Opened from Welcome\n");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, markdownPath);
  await button("Markdown").click();
  await page.getByRole("heading", { name: "Opened from Welcome" }).waitFor();
  await assertHidden(app);
  console.log("PASS Welcome cards: equal columns, keyboard focus, typed native filters, Canvas creation, and Markdown opening");
} finally {
  if (app) await closeHidden(app);
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
