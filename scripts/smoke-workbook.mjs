// Excel workbooks in the real desktop app (so also in a real utility process): opened from the OS and from the picker,
// read-only, one sheet at a time. Isolated profile, no visible window. Run after npm run build.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-workbook-"));
const shots = path.join(root, "release", "smoke");
mkdirSync(shots, { recursive: true });

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
// A cell near Excel's 32,767-character limit: the grid cuts it at 500, the read-only field must show all of it.
const LONG = Array.from({ length: 3000 }, (_, i) => `rodmuo${i}`).join(" ").slice(0, 32_000) + " GALAS";
const text = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
// Two worksheets that matter (a date, a number, Lithuanian text, a formula with its cached value), a sheet too wide to
// read completely (70 rows with a cell in the last column) and an empty one.
async function workbook(firstCell = "Žąsų gegužė") {
  const wide = Array.from({ length: 70 }, (_, i) => `<row r="${i + 1}">${text(`A${i + 1}`, `row ${i + 1}`)}${text(`XFD${i + 1}`, "far")}</row>`).join("");
  const sheets = [
    ["Pardavimai", `<row r="1">${text("A1", "Mėnuo")}${text("B1", "Suma")}${text("C1", "Data")}${text("D1", "Dvigubai")}</row>
<row r="2">${text("A2", firstCell)}<c r="B2"><v>12.5</v></c><c r="C2" s="1"><v>45000</v></c><c r="D2"><f>B2*2</f><v>25</v></c></row>
<row r="3">${text("A3", LONG)}</row>`],
    ["Kita lapo antraštė", `<row r="1">${text("A1", "Second sheet value")}</row>`],
    ["Didelis", wide],
    ["Tuščias", ""],
  ];
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${sheets.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  sheets.forEach(([, rows], i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`));
  zip.file("xl/styles.xml", `<styleSheet xmlns="${MAIN}"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdT" Type="${REL}/styles" Target="styles.xml"/></Relationships>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const good = path.join(temp, "Sales.xlsx"), broken = path.join(temp, "Broken.xlsx"), old = path.join(temp, "Legacy.xls"), locked = path.join(temp, "Locked.xlsx");
writeFileSync(good, await workbook());
writeFileSync(broken, "this is not a zip file");
// A real .xls starts with the OLE container signature; so does a password-protected .xlsx (which also holds this stream).
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
writeFileSync(old, Buffer.concat([OLE, Buffer.alloc(512)]));
writeFileSync(locked, Buffer.concat([OLE, Buffer.alloc(512), Buffer.from("EncryptedPackage", "utf16le")]));

const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
const errors = [];
try {
  const page = readerPage(await app.firstWindow());
  page.on("pageerror", error => errors.push(error.stack ?? String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const docs = page.getByRole("tablist", { name: "Open documents" });
  const grid = name => page.getByRole("grid", { name });
  const cell = async (row, col) => page.locator(`[data-r="${row}"][data-c="${col}"]`).innerText();
  const sheetTab = name => page.getByRole("tablist", { name: "Sheets", exact: true }).getByRole("tab", { name, exact: true });
  // The OS hands the file over: macOS open-file, Windows/Linux argv and "Open with" all end in the same main-process path.
  const openFromOs = file => app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  const readerText = () => page.evaluate(() => document.body.innerText);
  const messageShown = async fragment => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if ((await readerText()).includes(fragment)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`never showed: ${fragment}\n${await readerText()}`);
  };

  // 1. The first sheet's cells, the read-only state, and what editing would need is absent.
  await openFromOs(good);
  await grid("Sheet Pardavimai").waitFor({ timeout: 30_000 });
  assert.deepEqual(await Promise.all([[0, 0], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]].map(([r, c]) => cell(r, c))),
    ["Mėnuo", "Dvigubai", "Žąsų gegužė", "12.5", "2023-03-15", "25"]);
  await docs.getByRole("tab", { name: /Sales\.xlsx/, selected: true }).waitFor();
  assert.equal(await page.locator(".content-save-status").innerText(), "Read-only · 4 sheets");
  assert.equal(await grid("Sheet Pardavimai").getAttribute("aria-readonly"), "true");
  for (const gone of [page.getByRole("button", { name: /^Save/ }), page.getByRole("button", { name: "Add row", exact: true }),
    page.getByRole("dialog"), page.locator(".dirty-dot")]) assert.equal(await gone.count(), 0);
  await page.getByRole("button", { name: "File", exact: true }).click();
  assert.deepEqual(await page.getByRole("menuitem").allInnerTexts().then(items => items.map(item => item.trim())), ["Open…", "Print…", "Update settings…"]);
  await page.keyboard.press("Escape");
  const nativeFile = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === "File").submenu.items
    .filter(item => ["Save", "Save As…", "Export / Convert…", "Print…"].includes(item.label)).map(item => [item.label, item.enabled]));
  assert.deepEqual(nativeFile, [["Save", false], ["Save As…", false], ["Export / Convert…", false], ["Print…", true]]);
  // Typing, Delete and Ctrl/Cmd+S open nothing. Enter, F2 and a double click open the full text in a read-only field
  // (the grid cuts long cells; this changed from "opens nothing" when reading long cells became a requirement).
  const field = page.getByRole("textbox", { name: "Cell value", exact: true });
  const target = page.locator('[data-r="1"][data-c="0"]');
  await target.focus();
  for (const key of ["x", "Delete", "ControlOrMeta+s"]) await page.keyboard.press(key);
  assert.equal(await page.locator("textarea").count(), 0, "typing, Delete or save opened a field in a read-only table");
  const longCell = page.locator('[data-r="2"][data-c="0"]');
  assert.ok((await longCell.innerText()).length <= 501, "the grid shows the whole long text");
  for (const open of [() => page.keyboard.press("Enter"), () => page.keyboard.press("F2"), () => longCell.dblclick()]) {
    await longCell.focus();
    await open();
    await field.waitFor();
    assert.equal(await field.inputValue(), LONG, "the read-only field must hold the full text");
    assert.equal(await field.getAttribute("readonly"), "", "the field is not read-only");
    assert.equal(await field.getAttribute("aria-readonly"), "true");
    assert.equal(await field.evaluate(el => el === document.activeElement), true, "the field takes focus");
    assert.equal(await field.evaluate(el => el.scrollHeight > el.clientHeight), true, "the long text must scroll inside the field");
    // Typing, Delete and Enter change nothing; the text can be selected.
    for (const key of ["x", "Delete", "Backspace"]) await page.keyboard.press(key);
    assert.equal(await field.inputValue(), LONG, "a read-only field changed");
    await page.keyboard.press("ControlOrMeta+a");
    assert.equal(await field.evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length), true, "the text cannot be selected");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.equal(await longCell.evaluate(el => el === document.activeElement), true, "focus returns to the cell");
  }
  await longCell.focus();
  await page.keyboard.press("Enter");
  await field.waitFor();
  await page.keyboard.press("Enter");
  await field.waitFor({ state: "detached" });
  await longCell.focus();
  await page.keyboard.press("F2");
  await field.waitFor();
  await target.click();
  await field.waitFor({ state: "detached" });
  assert.equal(await target.evaluate(el => el === document.activeElement), true, "clicking another cell moves focus there");
  assert.equal(await cell(1, 0), "Žąsų gegužė");
  assert.equal(await cell(0, 0), "Mėnuo");
  assert.equal(await page.locator(".content-save-status").innerText(), "Read-only · 4 sheets", "a read-only field marked the document changed");
  console.log("ok  first sheet cells (text, number, date, formula value), read-only state, no save or edit commands, long text opens read-only in full");

  // 2. Sheets switch by keyboard; the grid is named after the selected sheet.
  await sheetTab("Pardavimai").focus();
  await page.keyboard.press("ArrowRight");
  await grid("Sheet Kita lapo antraštė").waitFor();
  assert.equal(await cell(0, 0), "Second sheet value");
  assert.equal(await sheetTab("Kita lapo antraštė").getAttribute("aria-selected"), "true");
  assert.equal(await sheetTab("Pardavimai").getAttribute("tabindex"), "-1");
  await page.keyboard.press("ArrowRight");
  await grid("Sheet Didelis").waitFor();
  await page.getByText("This sheet is too large to show completely.").waitFor();
  await page.keyboard.press("ArrowRight");
  await page.getByText("This sheet is empty.").waitFor();
  assert.equal(await page.getByText("This sheet is too large").count(), 0, "the notice follows the sheet");
  await page.keyboard.press("ArrowRight");
  assert.equal(await sheetTab("Tuščias").getAttribute("aria-selected"), "true", "the last tab stays selected");
  await page.keyboard.press("Home");
  await grid("Sheet Pardavimai").waitFor();
  assert.equal(await cell(1, 0), "Žąsų gegužė");
  await page.keyboard.press("End");
  await page.getByText("This sheet is empty.").waitFor();
  await page.keyboard.press("ArrowLeft");
  await grid("Sheet Didelis").waitFor();
  console.log("ok  sheet tabs: arrows, Home/End, grid label, too-large and empty-sheet notices");

  // 3. The visible sheet prints as a plain table.
  await sheetTab("Pardavimai").click();
  await page.evaluate(() => { window.printed = ""; window.print = () => { window.printed = document.querySelector(".markdown-print")?.innerHTML ?? "none"; }; });
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Print…", exact: true }).click();
  await page.waitForFunction(() => window.printed);
  const printed = await page.evaluate(() => window.printed);
  assert.match(printed, /<td>Žąsų gegužė<\/td><td>12\.5<\/td><td>2023-03-15<\/td><td>25<\/td>/);
  assert.equal(await page.locator(".markdown-print").count(), 0, "the print view is removed afterwards");
  console.log("ok  print renders the visible sheet as a table");

  // 4. Opening again shows the file as it is now (nothing is cached), in a tab of its own; the temp snapshots are gone.
  writeFileSync(good, await workbook("Changed on disk"));
  await openFromOs(good);
  await docs.getByRole("tab", { name: /Sales\.xlsx/, selected: true }).waitFor();
  await page.locator('[data-r="1"][data-c="0"]').filter({ hasText: "Changed on disk" }).waitFor();
  assert.equal(await docs.getByRole("tab", { name: /Sales\.xlsx/ }).count(), 2);
  const profile = await app.evaluate(({ app }) => app.getPath("userData"));
  assert.deepEqual(readdirSync(profile).filter(name => name.startsWith("xlsx-tmp-")), [], "temporary snapshots were not cleaned up");
  await page.window.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the workbook overflows a phone-width window");
  await page.screenshot({ path: path.join(shots, "workbook-mobile.png") });
  await page.window.setViewportSize({ width: 1280, height: 900 });
  // The button names the theme it switches to; the first run follows the system appearance.
  const useTheme = async theme => {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme`, exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  };
  for (const theme of ["dark", "light"]) {
    await useTheme(theme);
    await sheetTab("Pardavimai").click();
    await page.screenshot({ path: path.join(shots, `workbook-${theme}.png`) });
    await page.locator('[data-r="2"][data-c="0"]').dblclick();
    await page.getByRole("textbox", { name: "Cell value", exact: true }).waitFor();
    await page.screenshot({ path: path.join(shots, `workbook-${theme}-longtext.png`) });
    await page.keyboard.press("Escape");
    await sheetTab("Didelis").click();
    await page.getByText("This sheet is too large to show completely.").waitFor();
    await page.screenshot({ path: path.join(shots, `workbook-${theme}-notice.png`) });
  }
  console.log("ok  reopening reads the current file, snapshots are removed, themes and phone width look right");

  // 5. Failures say why, in the app's own error presentation, and leave no stray document tab behind.
  const tabCount = () => docs.getByRole("tab").count();
  const before = await tabCount();
  for (const [file, message] of [[broken, "Couldn't open “Broken.xlsx”. This isn't a valid .xlsx workbook."],
    [old, "Couldn't open “Legacy.xls”. Old .xls files aren't supported. Save it as .xlsx in Excel, then open it again."],
    [locked, "Couldn't open “Locked.xlsx”. This workbook is password-protected."]]) {
    await openFromOs(file);
    await messageShown(message);
    await page.screenshot({ path: path.join(shots, `workbook-error-${path.basename(file, path.extname(file))}.png`) });
    await docs.getByRole("tab", { name: path.basename(file) }).waitFor({ state: "detached", timeout: 5_000 });
  }
  console.log("ok  invalid, old .xls and password-protected files show their message");

  // 6. The picker: a valid workbook, then an .xls, from the library like any other file.
  // A failed open leaves the tab as the library (where the failure is shown), ready for the next file.
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Open a file/ }).click();
  await (await chooser).setFiles(good);
  await grid("Sheet Pardavimai").waitFor({ timeout: 30_000 });
  assert.equal(await cell(1, 0), "Changed on disk");
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Open a file/ }).click();
  await (await chooser).setFiles(old);
  await messageShown("Old .xls files aren't supported. Save it as .xlsx in Excel, then open it again.");
  assert.doesNotMatch(await readerText(), /Error invoking remote method/);
  console.log("ok  picker opens a workbook and shows the .xls message");

  await assertHidden(app);
  assert.deepEqual(errors, []);
  console.log(`PASS workbook (${process.platform}): read-only sheets, tabs, print, errors and picker in a real utility process`);
} catch (error) {
  console.error(error);
  const window = app.windows()[0];
  if (window) await window.screenshot({ path: path.join(shots, "workbook-failure.png") }).catch(() => {});
  throw error;
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
