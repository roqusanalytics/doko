// Real desktop content flows, with an isolated profile and no visible window. Run after npm run build.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
// The installed archive can run in the same hidden harness without opening the user's app.
const appPath = process.env.FOLIO_CONTENT_APP || root;
const temp = mkdtempSync(path.join(tmpdir(), "folio-content-"));
const shots = path.join(root, "release", "smoke");
const photos = path.join(temp, "Photos");
mkdirSync(photos);
mkdirSync(shots, { recursive: true });
const original = "# Field notes\n\nOriginal **Markdown**.\n";
const first = path.join(temp, "Notes.md"), second = path.join(temp, "Other.markdown");
writeFileSync(first, "\ufeff" + original.replaceAll("\n", "\r\n"));
writeFileSync(second, original);
writeFileSync(path.join(photos, "notes.txt"), "not an image");
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [appPath, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
const errors = [];
try {
  const page = readerPage(await app.firstWindow());
  page.on("pageerror", error => errors.push(error.stack ?? String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  if (process.env.FOLIO_CONTENT_APP) {
    assert.equal(await app.evaluate(({ app }) => app.getName()), "Folio Local");
    assert.equal(await page.evaluate(() => window.folioDesktop.getAutoUpdateEnabled()), true);
  }
  const editor = () => page.getByRole("textbox", { name: "Markdown source", exact: true });
  const preview = () => page.getByLabel("Markdown preview", { exact: true });
  const source = async () => {
    if (!(await editor().isVisible())) await page.getByRole("button", { name: "View source", exact: true }).click();
    await editor().waitFor();
  };
  const view = async () => {
    if (!(await preview().isVisible())) await page.getByRole("button", { name: "View", exact: true }).click();
    await preview().waitFor();
  };
  const edit = async text => {
    await source();
    await editor().focus();
    await page.keyboard.press("ControlOrMeta+a");
    if (text) await page.keyboard.insertText(text);
    else await page.keyboard.press("Backspace");
  };
  // Read only short fixtures: CodeMirror deliberately virtualizes long documents.
  const editorText = () => editor().locator(".cm-line").evaluateAll(lines => lines.map(line => line.textContent).join("\n"));
  const docs = page.getByRole("tablist", { name: "Open documents" });
  await page.window.evaluate(() => {
    window.contentOpened = 0;
    window.folioDesktop.content.onOpen(() => window.contentOpened++);
  });
  const open = async (file, expectContent = true) => {
    const before = await page.window.evaluate(() => window.contentOpened);
    await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
    if (expectContent) await page.window.waitForFunction(before => window.contentOpened > before, before);
  };
  const save = async () => { await editor().focus(); await page.keyboard.press("ControlOrMeta+s"); };
  const diskIs = async (file, expected) => {
    await assertEventually(() => readFileSync(file, "utf8") === expected, "saved file did not match the editor");
  };
  const close = async name => {
    const button = docs.getByRole("button", { name: `Close ${name}`, exact: true });
    if (await button.count()) await button.click();
    else await page.keyboard.press("ControlOrMeta+w");
  };

  await open(first);
  await preview().getByRole("heading", { name: "Field notes", exact: true }).waitFor();
  assert.equal(await editor().isVisible(), false, "Markdown must open in rendered View");
  await source();
  assert.equal(await editorText(), original);
  await page.window.waitForFunction(() => document.querySelectorAll('.window-drag-area').length === 1);
  assert.equal(await page.evaluate(() => {
    const update = [...document.querySelectorAll('.topbar button')].find(button => button.textContent === "Updates");
    const a = parent.document.querySelector('.window-drag-area');
    if (!update || !a) return false;
    const center = frameElement.getBoundingClientRect().left + update.getBoundingClientRect().left + update.getBoundingClientRect().width / 2;
    return parent.getComputedStyle(a).webkitAppRegion === "drag" && [...a.children].some(h => {
      const b = h.getBoundingClientRect(); return center >= b.left - 1 && center <= b.right + 1;
    });
  }), true, "Markdown Updates button needs a hole in the native drag region");
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  await page.getByRole("dialog", { name: "Updates", exact: true }).waitFor();
  await page.window.waitForFunction(() => document.querySelectorAll('.window-drag-area').length === 0);
  await page.keyboard.press("Escape");
  await page.window.waitForFunction(() => document.querySelectorAll('.window-drag-area').length === 1);
  assert.equal(await page.locator(".content-toolbar").evaluate(element => getComputedStyle(element).display), "flex", "reader styles were not loaded");
  assert.ok((await editor().boundingBox()).width > 300, "desktop Markdown editor collapsed");
  await view();
  await preview().getByRole("heading", { name: "Field notes", exact: true }).waitFor();
  const edited = "# Revised field notes\n\nSaved **bold** and $x^2$.\n";
  await edit(edited);
  await view();
  await preview().getByRole("heading", { name: "Revised field notes", exact: true }).waitFor();
  await source();
  await save();
  await diskIs(first, "\ufeff" + edited.replaceAll("\n", "\r\n"));
  await page.screenshot({ path: path.join(shots, "content-markdown.png") });
  console.log("ok  native Markdown open, preview and keyboard save preserve UTF-8 BOM and CRLF");

  await edit("# Unsaved local edit\n");
  await open(first);
  assert.equal(await editorText(), "# Unsaved local edit\n", "reopening the same file lost edits");
  assert.equal(await page.window.locator("iframe.document-reader").count(), 1, "same path created a duplicate tab");
  // Identical bytes in two paths must remain independent documents.
  writeFileSync(second, readFileSync(first));
  await open(second);
  await source();
  await docs.getByRole("tab", { name: /Other.markdown/, selected: true }).waitFor();
  assert.equal(await page.window.locator("iframe.document-reader").count(), 2);
  assert.equal(await editorText(), edited);
  await docs.getByRole("tab", { name: /Notes.md/ }).click();
  assert.equal(await editorText(), "# Unsaved local edit\n");

  const unsavedClose = docs.getByRole("button", { name: /Close Notes.md/ });
  await docs.getByRole("tab", { name: /Other.markdown/ }).click();
  await unsavedClose.click();
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
  await confirmation.waitFor();
  await docs.getByRole("tab", { name: /Notes.md/, selected: true }).waitFor();
  await open(first);
  assert.equal(await page.window.locator("iframe.document-reader").count(), 2, "reopening during pending close duplicated the file");
  await confirmation.waitFor();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await editorText(), "# Unsaved local edit\n");
  await unsavedClose.click();
  await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await docs.getByRole("tab", { name: /Notes.md/ }).waitFor({ state: "detached" });
  await open(first);
  await source();
  assert.equal(await editorText(), edited);
  await edit("# Save on close\n");
  await docs.getByRole("button", { name: /Close Notes.md/ }).click();
  await confirmation.getByRole("button", { name: "Save", exact: true }).click();
  await diskIs(first, "\ufeff# Save on close\r\n");
  await docs.getByRole("tab", { name: /Notes.md/ }).waitFor({ state: "detached" });
  await open(first);
  await source();
  assert.equal(await editorText(), "# Save on close\n");
  console.log("ok  file identity, independent identical files, close Cancel/Discard/Save and reopen");

  await edit("# Local changes\n");
  writeFileSync(first, "\ufeff# Changed outside Doko\r\n");
  await save();
  await page.getByRole("button", { name: "Reload from disk", exact: true }).waitFor();
  assert.equal(readFileSync(first, "utf8"), "\ufeff# Changed outside Doko\r\n", "conflict overwrote external edits");
  assert.equal(await editorText(), "# Local changes\n");
  await page.getByRole("button", { name: "Reload from disk", exact: true }).click();
  const reload = page.getByRole("dialog", { name: "Reload from disk", exact: true });
  await reload.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await editorText(), "# Local changes\n");
  await page.getByRole("button", { name: "Reload from disk", exact: true }).click();
  await reload.getByRole("button", { name: "Discard and reload", exact: true }).click();
  await assertEventually(async () => await editorText() === "# Changed outside Doko\n", "reload did not replace the source");
  await editor().focus();
  await page.keyboard.press("ControlOrMeta+z");
  assert.equal(await editorText(), "# Changed outside Doko\n", "Undo after reload resurrected discarded local text");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  assert.equal(await editorText(), "# Changed outside Doko\n", "Redo after reload changed the external version");
  await edit("");
  await save();
  await diskIs(first, "\ufeff");
  const untrusted = '# Safe title\n\n<script>window.contentExecuted = true</script>\n\n<img src="https://example.invalid/trap.png" onerror="window.contentExecuted = true">\n';
  await edit(untrusted);
  await view();
  await preview().getByRole("heading", { name: "Safe title" }).waitFor();
  assert.equal(await page.evaluate(() => Boolean(window.contentExecuted)), false);
  assert.equal(await preview().locator("script, img[src^='http']").count(), 0);
  const longText = "# Long text\n\n" + "A paragraph of notes. ".repeat(10_000);
  await edit(longText);
  await save();
  await diskIs(first, "\ufeff" + longText.replaceAll("\n", "\r\n"));
  console.log("ok  conflicts preserve both versions, explicit reload, empty/long text and inert HTML");
  await app.evaluate(({ dialog }) => {
    globalThis.contentOpenErrors = [];
    dialog.showErrorBox = (title, detail) => globalThis.contentOpenErrors.push({ title, detail });
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
  });
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  await assertEventually(async () => !await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), "cancelled Save copy did not finish");
  const preservedText = longText + "\nSaved after cancelled copy.";
  await edit(preservedText);
  await save();
  await diskIs(first, "\ufeff" + preservedText.replaceAll("\n", "\r\n"));
  await assertEventually(async () => await page.locator(".content-save-status").innerText() === "All changes saved", "save after cancelled Save copy did not finish");
  for (const [name, bytes] of [["invalid.md", Buffer.from([0xff, 0xfe, 0x61])], ["oversized.md", Buffer.alloc(5 * 1024 * 1024 + 1, 65)]]) {
    const file = path.join(temp, name);
    writeFileSync(file, bytes);
    const count = await app.evaluate(() => globalThis.contentOpenErrors.length);
    await open(file, false);
    await assertEventually(async () => (await app.evaluate(() => globalThis.contentOpenErrors.length)) > count, "invalid Markdown did not report an error");
    assert.ok((await editor().innerText()).startsWith("# Long text"), "invalid open replaced the current editor");
  }
  await editor().focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.insertText("\nPreserved after rejected opens.\n");
  await save();
  await diskIs(first, "\ufeff" + (preservedText + "\nPreserved after rejected opens.\n").replaceAll("\n", "\r\n"));
  console.log("ok  cancelled Save copy and invalid/oversized Markdown leave the current document intact");

  // Plain text uses the same document path, with an editor only and the file's own encoding.
  const textEditor = () => page.getByRole("textbox", { name: "Text document", exact: true });
  const textStatus = () => page.locator(".content-save-status").innerText();
  const textLines = () => textEditor().locator(".cm-line").evaluateAll(lines => lines.map(line => line.textContent).join("\n"));
  const plain = path.join(temp, "Plain.txt"), legacy = path.join(temp, "Legacy.txt");
  writeFileSync(plain, "First line\r\nSecond line\r\n");
  await open(plain);
  await textEditor().waitFor();
  assert.equal(await textLines(), "First line\nSecond line\n");
  for (const gone of [page.getByRole("button", { name: "View source", exact: true }), page.getByLabel("Markdown preview", { exact: true }),
    page.getByRole("navigation", { name: "Document sections", exact: true })]) assert.equal(await gone.count(), 0, "text opens in the editor only");
  assert.equal(await textStatus(), "All changes saved · UTF-8");
  await textEditor().focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Edited plain\nsecond ąž\n");
  assert.equal(await textStatus(), "Unsaved changes · UTF-8");
  await page.keyboard.press("ControlOrMeta+s");
  await diskIs(plain, "Edited plain\r\nsecond ąž\r\n");
  await assertEventually(async () => await textStatus() === "All changes saved · UTF-8", "text save did not finish");
  await page.screenshot({ path: path.join(shots, "content-text.png") });
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export / Convert…", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export text", exact: true });
  await exportDialog.waitFor();
  assert.equal(await exportDialog.getByRole("button", { name: "Save HTML…" }).count(), 0, "text has no HTML export");
  await page.keyboard.press("Escape");
  await close("Plain.txt");
  await docs.getByRole("tab", { name: /Plain.txt/ }).waitFor({ state: "detached" });
  await open(plain);
  await textEditor().waitFor();
  assert.equal(await textLines(), "Edited plain\nsecond ąž\n");
  await close("Plain.txt");
  await docs.getByRole("tab", { name: /Plain.txt/ }).waitFor({ state: "detached" });

  // A legacy single-byte file keeps its bytes until the user chooses UTF-8 for a character it cannot hold.
  const legacyBytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a]);
  writeFileSync(legacy, legacyBytes);
  await open(legacy);
  await textEditor().waitFor();
  assert.match(await textStatus(), /^All changes saved · Windows-125[27]$/);
  assert.equal(await textLines(), "café\n");
  await textEditor().focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.insertText("Ж");
  await page.keyboard.press("ControlOrMeta+s");
  const refusal = page.getByRole("alert").filter({ hasText: "Nothing was saved" });
  await refusal.waitFor();
  assert.ok(readFileSync(legacy).equals(legacyBytes), "an unencodable save must not touch the file");
  assert.equal(await textLines(), "café\nЖ", "the text stays in the editor");
  await refusal.getByRole("button", { name: "Save as UTF-8", exact: true }).click();
  await diskIs(legacy, "café\r\nЖ");
  await assertEventually(async () => await textStatus() === "All changes saved · UTF-8", "Save as UTF-8 did not switch the encoding");
  assert.equal(await refusal.count(), 0);
  await close("Legacy.txt");
  await docs.getByRole("tab", { name: /Legacy.txt/ }).waitFor({ state: "detached" });
  const binary = path.join(temp, "Binary.txt");
  writeFileSync(binary, Buffer.from("a\0b"));
  const errorsBefore = await app.evaluate(() => globalThis.contentOpenErrors.length);
  await open(binary, false);
  await assertEventually(async () => (await app.evaluate(() => globalThis.contentOpenErrors.length)) > errorsBefore, "binary .txt did not report an error");
  assert.match(await app.evaluate(() => globalThis.contentOpenErrors.at(-1).detail), /isn't plain text or uses an encoding Doko can't read/);
  console.log("ok  native .txt opens editor-only, saves in its encoding with CRLF, offers Save as UTF-8 and rejects binary files");

  // CSV: the table is a view of the text in the editor, so save, undo, dirty state and encodings are the ones above.
  const grid = () => page.getByRole("grid", { name: "CSV table", exact: true });
  const cell = (row, col) => grid().locator(`[data-r="${row}"][data-c="${col}"]`);
  const cellText = async (row, col) => (await cell(row, col).innerText()).trim();
  const footer = () => page.locator(".tv-footer [role=status]").innerText();
  const useTheme = async theme => {
    const toggle = page.getByRole("button", { name: `Use ${theme} theme`, exact: true });
    if (await toggle.count()) await toggle.click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  };
  const csvFile = path.join(temp, "Kontaktai.csv");
  const csvLines = ["Vardas;Miestas;Pastaba", 'Žygimantas;Šiauliai;"Sakė: ""labas""; rytas"', 'Austėja;Kaunas;"Pirma eilutė\r\nantra eilutė"', "Rokas;Vilnius;"];
  const csvOriginal = csvLines.join("\r\n") + "\r\n";
  writeFileSync(csvFile, csvOriginal);
  await open(csvFile);
  await grid().waitFor();
  assert.equal(await textStatus(), "All changes saved · UTF-8 · Delimiter: ;");
  assert.equal(await page.getByRole("button", { name: "Table", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("textbox", { name: "CSV source", exact: true }).isVisible(), false, "the editor stays hidden in table mode");
  assert.equal(await footer(), "4 rows × 3 columns");
  assert.equal(await grid().getAttribute("aria-rowcount"), "5");
  assert.equal(await grid().getAttribute("aria-colcount"), "4");
  assert.deepEqual([await cellText(0, 0), await cellText(1, 0), await cellText(1, 1), await cellText(1, 2)], ["Vardas", "Žygimantas", "Šiauliai", 'Sakė: "labas"; rytas']);
  assert.equal(await cell(0, 0).getAttribute("tabindex"), "0", "one tab stop");
  assert.equal(await grid().locator('[tabindex="0"]').count(), 1);
  await useTheme("light");
  await page.screenshot({ path: path.join(shots, "content-csv-light.png") });

  // Edit through the table: Enter starts, Enter commits and moves down; undo and redo run the editor history.
  await cell(1, 1).click();
  await page.keyboard.press("Enter");
  const field = () => page.getByRole("textbox", { name: "Cell value", exact: true });
  await field().waitFor();
  assert.equal(await field().inputValue(), "Šiauliai");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Panevėžys");
  await page.keyboard.press("Enter");
  await field().waitFor({ state: "detached" });
  assert.equal(await cellText(1, 1), "Panevėžys");
  assert.equal(await cell(2, 1).getAttribute("data-active"), "true", "Enter moves down");
  assert.equal(await textStatus(), "Unsaved changes · UTF-8 · Delimiter: ;");
  await page.keyboard.press("ControlOrMeta+z");
  await assertEventually(async () => await cellText(1, 1) === "Šiauliai", "undo did not reach the table");
  assert.equal(await textStatus(), "All changes saved · UTF-8 · Delimiter: ;", "undo returns to the saved text");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await assertEventually(async () => await cellText(1, 1) === "Panevėžys", "redo did not reach the table");
  // Esc cancels, typing starts an edit, a multi-line cell opens in the same field, Alt+Enter adds a line break.
  await cell(3, 0).click();
  await page.keyboard.press("F2");
  await page.keyboard.insertText("changed");
  await page.keyboard.press("Escape");
  assert.equal(await cellText(3, 0), "Rokas", "Esc keeps the old value");
  await cell(2, 2).click();
  await page.keyboard.press("Enter");
  assert.equal(await field().inputValue(), "Pirma eilutė\nantra eilutė");
  await page.keyboard.press("Escape");
  // Add row, type into it (typing starts the edit), Tab commits and moves right.
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  assert.equal(await footer(), "5 rows × 3 columns");
  await page.keyboard.type("Jonas");
  await page.keyboard.press("Tab");
  await field().waitFor({ state: "detached" });
  assert.equal(await cellText(4, 0), "Jonas");
  assert.equal(await cell(4, 1).getAttribute("data-active"), "true", "Tab moves right");
  // A cell edit that is still open is part of the save.
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Marijampolė");
  await page.keyboard.press("ControlOrMeta+s");
  const csvRowsEdited = csvLines.slice();
  csvRowsEdited[1] = 'Žygimantas;Panevėžys;"Sakė: ""labas""; rytas"';
  const csvEdited = csvRowsEdited.join("\r\n") + "\r\nJonas;Marijampolė;\r\n";
  await diskIs(csvFile, csvEdited);
  await assertEventually(async () => (await textStatus()).startsWith("All changes saved"), "CSV save did not finish");
  // Row and column operations come from the context menu and are single undo steps.
  await cell(1, 1).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions for cell B2", exact: true });
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: "Insert column right", exact: true }).click();
  assert.equal(await footer(), "5 rows × 4 columns");
  await page.keyboard.press("ControlOrMeta+z");
  await assertEventually(async () => await footer() === "5 rows × 3 columns", "undo did not remove the inserted column");
  await grid().getByRole("rowheader", { name: "3", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete row", exact: true }).click();
  assert.equal(await footer(), "4 rows × 3 columns");
  await page.keyboard.press("ControlOrMeta+z");
  await assertEventually(async () => await footer() === "5 rows × 3 columns", "undo did not restore the deleted row");
  assert.equal(await cellText(2, 2), "Pirma eilutė antra eilutė", "line breaks show as spaces in the cell");
  await page.keyboard.press("Delete");
  assert.equal(await cellText(2, 2), "", "Delete clears the active cell");
  await page.keyboard.press("ControlOrMeta+z");
  await assertEventually(async () => (await cellText(2, 2)).startsWith("Pirma"), "undo did not restore the cleared cell");
  // Source mode shows the same text; the delimiter and CRLF stay.
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const csvSource = page.getByRole("textbox", { name: "CSV source", exact: true });
  await csvSource.waitFor();
  assert.equal(await csvSource.locator(".cm-line").evaluateAll(lines => lines.map(line => line.textContent).join("\n")), csvEdited.replaceAll("\r\n", "\n"));
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await grid().waitFor();
  // Dark appearance.
  await useTheme("dark");
  await cell(1, 1).click();
  await page.screenshot({ path: path.join(shots, "content-csv-dark.png") });
  await useTheme("light");
  // Reopening reads the saved bytes back into the table.
  await close("Kontaktai.csv");
  await docs.getByRole("tab", { name: /Kontaktai.csv/ }).waitFor({ state: "detached" });
  await open(csvFile);
  await grid().waitFor();
  assert.equal(await footer(), "5 rows × 3 columns");
  assert.deepEqual([await cellText(1, 1), await cellText(4, 0), await cellText(4, 1)], ["Panevėžys", "Jonas", "Marijampolė"]);
  await close("Kontaktai.csv");
  await docs.getByRole("tab", { name: /Kontaktai.csv/ }).waitFor({ state: "detached" });

  // An empty file is an empty grid with Add row; a long CSV renders only the visible rows.
  const emptyCsv = path.join(temp, "Tuscias.csv"), bigCsv = path.join(temp, "Didelis.csv"), hugeCsv = path.join(temp, "Per-didelis.csv");
  writeFileSync(emptyCsv, "");
  await open(emptyCsv);
  await page.getByText("This file is empty. Add a row to start.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  assert.equal(await footer(), "1 row × 1 column");
  await docs.getByRole("button", { name: /Close Tuscias.csv/ }).click();
  await page.getByRole("dialog", { name: "Unsaved changes", exact: true }).getByRole("button", { name: "Discard", exact: true }).click();
  await docs.getByRole("tab", { name: /Tuscias.csv/ }).waitFor({ state: "detached" });
  // The delimiter is only pinned once a parse yields two columns: a first typed character must not decide it for good.
  await open(emptyCsv);
  await page.getByText("This file is empty. Add a row to start.", { exact: true }).waitFor();
  const csvSourceBox = page.getByRole("textbox", { name: "CSV source", exact: true });
  const setCsvSource = async text => {
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await csvSourceBox.waitFor();
    await csvSourceBox.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(text);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await grid().waitFor();
  };
  await setCsvSource("a");
  assert.equal(await footer(), "1 row × 1 column");
  await setCsvSource("a;b\n1;2\n");
  assert.equal(await footer(), "2 rows × 2 columns", "typing a;b after a first single-column text splits on ;");
  assert.match(await textStatus(), /Delimiter: ;$/);
  await setCsvSource("sep=|\nx|y|z\n");
  assert.match(await textStatus(), /Delimiter: \|$/, "a sep= line keeps winning");
  await docs.getByRole("button", { name: /Close Tuscias.csv/ }).click();
  await page.getByRole("dialog", { name: "Unsaved changes", exact: true }).getByRole("button", { name: "Discard", exact: true }).click();
  await docs.getByRole("tab", { name: /Tuscias.csv/ }).waitFor({ state: "detached" });
  // Exported copies are friendly to Excel: CSV gets a BOM and the file's own endings, text keeps its endings and BOM state.
  const exportCsv = path.join(temp, "Eksportas.csv"), exportTxt = path.join(temp, "Eksportas.txt");
  const exportedCsv = path.join(temp, "Eksportuota.csv"), exportedTxt = path.join(temp, "Eksportuota.txt");
  writeFileSync(exportCsv, 'Vardas;Miestas\r\nŽygimantas;"Šiauliai\r\nčia"\r\n');
  writeFileSync(exportTxt, "Ąžuolas\r\nantra\r\n");
  const exportTo = async (name, dialogName, button, destination) => {
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, destination);
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Export / Convert…", exact: true }).click();
    const exporting = page.getByRole("dialog", { name: dialogName, exact: true });
    await exporting.waitFor();
    await exporting.getByRole("button", { name: button, exact: true }).click();
    await exporting.waitFor({ state: "detached" });
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined }); });
    await close(name);
    await docs.getByRole("tab", { name: new RegExp(name) }).waitFor({ state: "detached" });
  };
  await open(exportCsv); await grid().waitFor();
  await exportTo("Eksportas.csv", "Export CSV", "Save CSV…", exportedCsv);
  assert.ok(readFileSync(exportedCsv).equals(Buffer.from('﻿Vardas;Miestas\r\nŽygimantas;"Šiauliai\r\nčia"\r\n')), "CSV export: UTF-8 BOM, CRLF rows and in-cell CRLF");
  await open(exportTxt); await textEditor().waitFor();
  await exportTo("Eksportas.txt", "Export text", "Save text…", exportedTxt);
  assert.ok(readFileSync(exportedTxt).equals(Buffer.from("Ąžuolas\r\nantra\r\n")), "text export: CRLF kept, no BOM added");
  console.log("ok  CSV delimiter re-detects until two columns, and exported CSV/text copies keep their line endings (CSV with a BOM)");
  writeFileSync(bigCsv, Array.from({ length: 100_000 }, (_, i) => `${i + 1};ąčęėįšųūž;"x, ${i}";${i * 3}`).join("\n") + "\n");
  const started = Date.now();
  await open(bigCsv);
  await grid().waitFor();
  assert.equal(await footer(), "100,000 rows × 4 columns");
  assert.ok(await grid().locator('[role="gridcell"]').count() < 400, "only visible rows are rendered");
  await cell(0, 0).click();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await assertEventually(async () => await cellText(99_999, 0) === "100000", "Ctrl+Down did not reach the last row");
  assert.ok(await grid().locator('[role="gridcell"]').count() < 400);
  console.log(`ok  100k-row CSV opened and navigated in ${Date.now() - started} ms`);
  // Printing builds 400k table cells; the old insertRow()/insertCell() build was quadratic and froze the page for minutes.
  await page.evaluate(() => {
    window.printed = null;
    window.print = () => {
      const rows = document.querySelector(".markdown-print table")?.rows;
      window.printed = { count: rows?.length, first: rows?.[0].innerHTML, last: rows?.[rows.length - 1].innerHTML };
    };
  });
  const printStarted = Date.now();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Print…", exact: true }).click();
  await page.waitForFunction(() => window.printed, null, { timeout: 30_000 });
  const printMs = Date.now() - printStarted;
  assert.deepEqual(await page.evaluate(() => window.printed), { count: 100_000,
    first: "<td>1</td><td>ąčęėįšųūž</td><td>x, 0</td><td>0</td>", last: "<td>100000</td><td>ąčęėįšųūž</td><td>x, 99999</td><td>299997</td>" });
  assert.ok(printMs < 10_000, `printing a 100k-row CSV took ${printMs} ms`);
  console.log(`ok  100k-row CSV prints as a table in ${printMs} ms`);
  await close("Didelis.csv");
  await docs.getByRole("tab", { name: /Didelis.csv/ }).waitFor({ state: "detached" });
  writeFileSync(hugeCsv, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
  const csvErrors = await app.evaluate(() => globalThis.contentOpenErrors.length);
  await open(hugeCsv, false);
  await assertEventually(async () => (await app.evaluate(() => globalThis.contentOpenErrors.length)) > csvErrors, "oversized CSV did not report an error");
  assert.match(await app.evaluate(() => globalThis.contentOpenErrors.at(-1).detail), /CSV is limited to 5 MB/);
  console.log("ok  native .csv opens as an editable table, edits through undo/redo, saves only the edited bytes, and handles empty, 100k-row and oversized files");

  const png = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(800 * 600 * 4, 190), { width: 800, height: 600 }).toPNG().toString("base64"));
  for (let i = 1; i <= 20; i++) writeFileSync(path.join(photos, `image${i}.png`), Buffer.from(png, "base64"));
  mkdirSync(path.join(photos, "Nested"));
  writeFileSync(path.join(photos, "Nested", "nested.png"), Buffer.from(png, "base64"));
  try { symlinkSync(path.join(photos, "image1.png"), path.join(photos, "linked.png")); }
  catch (error) { if (process.platform !== "win32" || error.code !== "EPERM") throw error; }
  await open(path.join(photos, "image10.png"));
  const gallery = page.getByRole("region", { name: "Photo gallery", exact: true });
  const position = page.getByLabel("Image position", { exact: true });
  const at = async (number, total = 20) => {
    await page.waitForFunction(({ number, total }) => document.querySelector('[aria-label="Image position"]')?.textContent.replace(/\s/g, "") === `${number}/${total}` && !document.querySelector('.photo-status') && !!document.querySelector('.page canvas'), { number, total });
  };
  await gallery.waitFor(); await at(10);
  assert.equal(await gallery.getByRole("button", { name: "View image10.png", exact: true }).getAttribute("aria-current"), "true");
  await page.getByTitle("Zoom", { exact: true }).click();
  await page.getByRole("menuitem", { name: "100%", exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.page .canvasWrapper').getBoundingClientRect().width - 800) < 2);
  await page.getByRole("button", { name: "Next image", exact: true }).click(); await at(11);
  await page.getByRole("button", { name: "Previous image", exact: true }).click(); await at(10);
  await page.getByTitle("Zoom", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Fit image", exact: true }).click();
  assert.deepEqual(await gallery.locator("button[data-file]").evaluateAll(cards => cards.map(card => card.dataset.file)), Array.from({ length: 20 }, (_, i) => `image${i + 1}.png`));
  await gallery.getByRole("button", { name: "View image10.png", exact: true }).focus();
  await page.keyboard.press("ArrowRight"); await at(11);
  await page.keyboard.press("ArrowLeft"); await at(10);
  await open(path.join(photos, "image2.png")); await at(2);
  assert.equal(await page.window.locator("iframe.document-reader").count(), 3, "same folder created a second photo tab");
  await page.getByRole("button", { name: "Previous image", exact: true }).click(); await at(1);
  assert.ok(await page.getByRole("button", { name: "Previous image", exact: true }).isDisabled());
  await gallery.getByRole("button", { name: "View image20.png", exact: true }).click(); await at(20);
  assert.ok(await page.getByRole("button", { name: "Next image", exact: true }).isDisabled());
  console.log("ok  20-photo natural order, native selection, sibling dedup, thumbnail keyboard and edges");

  writeFileSync(path.join(photos, "image21.png"), "corrupt image");
  await page.getByRole("button", { name: "Refresh gallery", exact: true }).click(); await at(20, 21);
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await page.locator('.photo-status').getByRole("button", { name: "Retry", exact: true }).waitFor();
  writeFileSync(path.join(photos, "image21.png"), Buffer.from(png, "base64"));
  await page.locator('.photo-status').getByRole("button", { name: "Retry", exact: true }).click(); await at(21, 21);
  await page.screenshot({ path: path.join(shots, "content-gallery.png") });
  console.log("ok  refresh preserves selected image; corrupt selected photo can be repaired and retried");
  const varied = path.join(temp, "Formats");
  mkdirSync(varied);
  const fixtures = JSON.parse(readFileSync(path.join(root, "scripts", "fixtures", "content-images.json"), "utf8"));
  fixtures.jpg = fixtures.jpeg;
  fixtures.png = png;
  for (const [extension, data] of Object.entries(fixtures)) writeFileSync(path.join(varied, `photo.${extension}`), Buffer.from(data, "base64"));
  for (const extension of Object.keys(fixtures)) {
    const name = `photo.${extension}`;
    await open(path.join(varied, name));
    await page.waitForFunction(name => document.querySelector(`[aria-label="View ${name}"]`)?.getAttribute("aria-current") === "true" && !document.querySelector('.photo-status') && !!document.querySelector('.page canvas'), name);
  }
  await page.screenshot({ path: path.join(shots, "content-image-formats.png") });
  await close("Formats");
  await docs.getByRole("tab", { name: "Photos", exact: true }).click();
  console.log("ok  actual JPEG/JPG/PNG/WEBP/GIF/BMP/AVIF files decode in the desktop gallery");

  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await page.window.setViewportSize({ width, height });
    for (const theme of ["dark", "light"]) {
      await page.keyboard.press("ControlOrMeta+,");
      await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
      await page.getByRole("radiogroup", { name: "Theme", exact: true }).getByRole("radio", { name: theme === "dark" ? "Dark" : "Light", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      assert.ok(await position.isVisible());
      const overflow = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,
        elements:[...document.querySelectorAll('body *')].filter(element=>element.checkVisibility() && element.getBoundingClientRect().right>innerWidth+1).slice(0,16).map(element=>({tag:element.tagName,cls:element.className,right:element.getBoundingClientRect().right,width:element.getBoundingClientRect().width}))}));
      if(overflow.scroll>overflow.width) await page.screenshot({path:path.join(shots,'content-overflow.png')});
      assert.ok(overflow.scroll <= overflow.width, `gallery overflows the window: ${JSON.stringify(overflow)}`);
      await page.screenshot({ path: path.join(shots, `content-gallery-${width}-${theme}.png`) });
    }
  }
  await docs.getByRole("tab", { name: /Notes.md/ }).click();
  await editor().waitFor();
  await page.window.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Markdown overflows the window");
  await view();
  await preview().getByRole("heading", { name: "Long text", exact: true }).waitFor();
  assert.equal(await editor().isVisible(), false);
  await page.screenshot({ path: path.join(shots, "content-markdown-mobile.png") });
  await source();
  await editor().waitFor();
  await close("Notes.md");
  await close("Other.markdown");
  await close("Photos");
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
  assert.match(await page.locator(".textLayer").first().innerText(), /A short tour of Doko/);
  await assertHidden(app);
  assert.deepEqual(errors, []);
  console.log(`PASS content (${process.platform}): responsive themes, PDF regression and hidden window`);
} catch (error) {
  console.error(error);
  const window = app.windows()[0];
  if (window) {
    await window.screenshot({ path: path.join(shots, "content-failure.png") }).catch(() => {});
    console.error(await readerPage(window).evaluate(() => ({ title: document.title,
      saveStatus: document.querySelector(".content-save-status")?.textContent,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent),
      focused: document.activeElement?.getAttribute("aria-label"),
      position: document.querySelector('[aria-label="Image position"]')?.textContent,
      scroll: [...document.querySelectorAll('[aria-label="Image gallery"]')].map(element => ({ top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight })) })).catch(() => null));
  }
  console.error(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.find(item => item.label === "File")?.submenu?.items
    .filter(item => item.label.startsWith("Save")).map(item => ({ label: item.label, enabled: item.enabled }))).catch(() => null));
  throw error;
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}

async function assertEventually(check, message) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message);
}
