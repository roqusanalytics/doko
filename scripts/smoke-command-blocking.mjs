// While the image viewer covers a PDF, menu commands are blocked like their shortcuts: Save, Print and Properties
// must not open behind it, and the native File menu shows them as unavailable.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-command-blocking-"));
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

  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 400, height: 400 });
    const context = canvas.getContext("2d");
    context.fillStyle = "#3a7"; context.fillRect(0, 0, 400, 400);

    return canvas.toDataURL("image/png").split(",")[1];
  });

  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(Buffer.from(png, "base64"));
  pdf.addPage([600, 800]).drawImage(image, { x: 150, y: 200, width: 300, height: 400 }); // The image menu skips full-page (scanned) images.
  await app.evaluate(({ BrowserWindow, dialog }, bytes) => {
    globalThis.commandBlockingTest = { saveDialogs: 0 };
    dialog.showSaveDialog = async () => { globalThis.commandBlockingTest.saveDialogs++;

 return { canceled: true }; };

    BrowserWindow.getAllWindows()[0].webContents.send("folio:open-file", { name: "Image page.pdf", data: Buffer.from(bytes) });
  }, [...await pdf.save()]);
  await page.window.waitForFunction(() => document.title.startsWith("Image page.pdf"));
  const sheet = page.locator('.page[data-page-number="1"] canvas').first();
  await sheet.waitFor();

  const menuEnabled = label => app.evaluate(({ Menu }, label) =>
    Menu.getApplicationMenu().items.find(item => item.label === "File").submenu.items.find(item => item.label === label)?.enabled, label);

  const command = name => app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0].webContents.send("folio:file-command", name), name);

  await sheet.click({ force: true }); // The text layer sits on top; the reader finds the image by position.
  await page.getByRole("button", { name: "View larger" }).click();
  const viewer = page.getByRole("dialog", { name: "Image" });
  await viewer.waitFor();

  await command("properties");
  await command("save-as");
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole("dialog", { name: "Document info" }).count(), 0, "menu Properties must not open behind the image viewer");
  assert.equal((await app.evaluate(() => globalThis.commandBlockingTest)).saveDialogs, 0, "menu Save As must not run behind the image viewer");
  assert.equal(await menuEnabled("Save As…"), false, "the File menu shows Save As unavailable while the image viewer is open");

  // Once the viewer closes, the same command works again.
  await viewer.getByRole("button", { name: "Close" }).click();
  await viewer.waitFor({ state: "detached" });
  await command("properties");
  await page.getByRole("dialog", { name: "Document info" }).waitFor();

  assert.deepEqual(errors, []);
  await assertHidden(app);
  console.log("PASS command blocking: menu Save As and Properties wait while the image viewer is open, like their shortcuts");
} catch (error) {
  console.error(error);
  await page?.screenshot({ path: path.join(shots, "command-blocking-failure.png"), timeout: 10_000 }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(() => { delete globalThis.commandBlockingTest; }).catch(() => {});
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
