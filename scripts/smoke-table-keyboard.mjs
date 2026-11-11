// The editable CSV table by keyboard, in the real desktop app: the footer control that opens the row/column menu (Mac keyboards
// have no ContextMenu key), characters typed with AltGr or Option, and shortcuts that must stay shortcuts.
// Isolated profile, no visible window. Run after npm run build.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-table-keys-"));
const shots = path.join(root, "release", "smoke");
mkdirSync(shots, { recursive: true });
const csv = path.join(temp, "Table.csv");
writeFileSync(csv, "Vardas;Miestas\r\nAustėja;Kaunas\r\nRokas;Vilnius\r\n");

const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
const errors = [];
try {
  const page = readerPage(await app.firstWindow());
  page.on("pageerror", error => errors.push(error.stack ?? String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  await page.window.evaluate(() => { window.contentOpened = 0; window.folioDesktop.content.onOpen(() => window.contentOpened++); });
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), csv);
  await page.window.waitForFunction(() => window.contentOpened > 0);

  const grid = page.getByRole("grid", { name: "CSV table", exact: true });
  await grid.waitFor();
  const cell = (row, col) => grid.locator(`[data-r="${row}"][data-c="${col}"]`);
  const cellText = async (row, col) => (await cell(row, col).innerText()).trim();
  const footer = () => page.locator(".tv-footer [role=status]").innerText();
  const field = page.getByRole("textbox", { name: "Cell value", exact: true });
  const rowsMenuButton = page.getByRole("button", { name: "Rows & columns", exact: true });
  const focusedCell = () => page.evaluate(() => {
    const el = document.activeElement;
    return el?.matches(".tv-cell") ? [Number(el.dataset.r), Number(el.dataset.c)] : null;
  });
  const settle = async check => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.fail(`condition never held: ${check}`);
  };
  const useTheme = async theme => {
    const toggle = page.getByRole("button", { name: `Use ${theme} theme`, exact: true });
    if (await toggle.count()) await toggle.click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  };
  // A key event as the keyboard layout delivers it, to the focused cell.
  const keydown = init => page.locator(".tv-cell:focus").dispatchEvent("keydown", { bubbles: true, cancelable: true, ...init });

  // 1. The footer control is a tab stop after the grid; Enter opens the actions menu for the active cell.
  assert.equal(await footer(), "3 rows × 2 columns");
  await cell(1, 0).click();
  await page.keyboard.press("Tab");
  assert.equal(await rowsMenuButton.evaluate(el => el === document.activeElement), true, "Tab from the grid does not reach the Rows & columns button");
  assert.equal(await rowsMenuButton.getAttribute("aria-haspopup"), "menu");
  await page.screenshot({ path: path.join(shots, "table-keyboard-focus.png") });
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Actions for cell A2", exact: true });
  await menu.waitFor();
  assert.equal(await rowsMenuButton.getAttribute("aria-expanded"), "true");
  assert.deepEqual((await menu.getByRole("menuitem").allInnerTexts()).map(item => item.trim()),
    ["Insert row above", "Insert row below", "Delete row", "Insert column left", "Insert column right", "Delete column"]);
  await page.screenshot({ path: path.join(shots, "table-keyboard-menu.png") });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "detached" });
  assert.equal(await footer(), "4 rows × 2 columns", "Insert row below did not add a row");
  await settle(async () => JSON.stringify(await focusedCell()) === "[2,0]");
  console.log("ok  Tab reaches Rows & columns, Enter opens the menu, Insert row below works and focus returns to the new row");

  // 2. Closing the menu with Esc returns to the active cell, not to the button.
  const activeMenu = page.getByRole("menu", { name: "Actions for cell A3", exact: true });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await activeMenu.waitFor();
  await page.keyboard.press("Escape");
  await activeMenu.waitFor({ state: "detached" });
  await settle(async () => JSON.stringify(await focusedCell()) === "[2,0]");
  assert.equal(await footer(), "4 rows × 2 columns");
  console.log("ok  Esc closes the menu without a change and focus returns to the active cell");

  // 3. Ctrl/Cmd+Z undoes the inserted row; it does not start an edit that types "z".
  await page.keyboard.press("ControlOrMeta+z");
  await settle(async () => await footer() === "3 rows × 2 columns");
  assert.equal(await page.locator("textarea").count(), 0, "Ctrl/Cmd+Z opened an editor");
  assert.equal(await cellText(2, 0), "Rokas");
  console.log("ok  Ctrl/Cmd+Z undoes the row and does not type z");

  // 4. A character the layout produces with AltGr starts the edit with that character: Windows/Linux report Ctrl+Alt plus
  // the AltGraph modifier; macOS reports Option.
  await cell(2, 1).click();
  await keydown({ key: "@", code: "Digit2", ctrlKey: true, altKey: true, modifierAltGraph: true });
  await field.waitFor();
  assert.equal(await field.inputValue(), "@", "an AltGr character did not start editing");
  await page.keyboard.press("Enter");
  await field.waitFor({ state: "detached" });
  assert.equal(await cellText(2, 1), "@");
  await cell(1, 1).click();
  await keydown({ key: "€", code: "KeyE", altKey: true, ctrlKey: true, modifierAltGraph: true });
  await field.waitFor();
  assert.equal(await field.inputValue(), "€");
  await page.keyboard.press("Escape");
  await field.waitFor({ state: "detached" });
  // Linux AltGr reports only the AltGraph modifier.
  await keydown({ key: "ł", modifierAltGraph: true });
  await field.waitFor();
  assert.equal(await field.inputValue(), "ł");
  await page.keyboard.press("Escape");
  await field.waitFor({ state: "detached" });
  // Option on a Mac types a character; on Windows/Linux Alt-only is a menu accelerator and must pass through.
  await keydown({ key: "å", code: "KeyA", altKey: true });
  if (process.platform === "darwin") {
    await field.waitFor();
    assert.equal(await field.inputValue(), "å", "an Option character did not start editing");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
  } else {
    assert.equal(await field.count(), 0, "an Alt-only key started editing");
  }
  // Real shortcuts and composition stay out of the editor.
  await keydown({ key: "a", code: "KeyA", ctrlKey: true });
  await keydown({ key: "a", code: "KeyA", metaKey: true });
  await keydown({ key: "z", code: "KeyZ", ctrlKey: true, altKey: true });
  await keydown({ key: "Process", code: "KeyA", keyCode: 229 });
  await keydown({ key: "a", code: "KeyA", isComposing: true });
  assert.equal(await field.count(), 0, "a shortcut or composition event started editing");
  console.log("ok  AltGr and Option characters start editing; shortcuts and IME composition do not");

  // 5. Ctrl/Cmd+Z also undoes the typed edit.
  await cell(2, 1).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await settle(async () => await cellText(2, 1) === "Vilnius");
  assert.equal(await page.locator("textarea").count(), 0);
  console.log("ok  Ctrl/Cmd+Z undoes the typed cell");

  // 6. Both themes and a phone-width window: the control keeps its label, nothing overlaps or scrolls sideways.
  for (const theme of ["light", "dark"]) {
    await useTheme(theme);
    await cell(1, 0).click();
    await page.keyboard.press("Tab");
    await page.screenshot({ path: path.join(shots, `table-keyboard-${theme}.png`) });
  }
  await page.window.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the table footer overflows a phone-width window");
  const boxes = await Promise.all([page.locator(".tv-footer [role=status]"), rowsMenuButton, page.getByRole("button", { name: "Add row", exact: true })].map(item => item.boundingBox()));
  const [status, menuButton, addRow] = boxes;
  const apart = (a, b) => a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
  assert.ok(apart(status, menuButton) && apart(menuButton, addRow) && apart(status, addRow), "footer items overlap at phone width");
  await page.screenshot({ path: path.join(shots, "table-keyboard-mobile.png") });
  await page.window.setViewportSize({ width: 1280, height: 900 });
  console.log("ok  footer control in light and dark, phone width without overlap");

  await assertHidden(app);
  assert.deepEqual(errors, []);
  console.log(`PASS table keyboard (${process.platform}): footer menu, AltGr/Option typing, shortcuts and undo`);
} catch (error) {
  console.error(error);
  const window = app.windows()[0];
  if (window) await window.screenshot({ path: path.join(shots, "table-keyboard-failure.png") }).catch(() => {});
  throw error;
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
