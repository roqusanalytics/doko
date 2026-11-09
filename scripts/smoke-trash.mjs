// macOS native Trash and permission recovery, using only disposable files and a hidden app.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden } from "./hidden-window.mjs";

if (process.platform !== "darwin") {
  console.log("SKIP native macOS Trash smoke: requires macOS");
  process.exit(0);
}
const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-trash-"));
const folder = path.join(temp, "Photos");
mkdirSync(folder);
const names = Array.from({ length: 3 }, () => `folio-trash-${randomUUID()}.png`);
const files = names.map(name => path.join(folder, name));
const trashPaths = names.map(name => path.join(homedir(), ".Trash", name));
for (const file of trashPaths) assert.equal(existsSync(file), false);
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let app, png;
try {
  app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio"], timeout: 60_000 });
  const page = readerPage(await app.firstWindow());
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  png = Buffer.from(await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 190), { width: 32, height: 32 }).toPNG().toString("base64")), "base64");
  for (const file of files) writeFileSync(file, png);
  await page.window.evaluate(() => {
    window.trashDocument = null;
    window.folioDesktop.content.onOpen(document => { window.trashDocument = document; });
  });
  await app.evaluate(({ dialog, shell }) => {
    globalThis.originalTrash = shell.trashItem.bind(shell);
    globalThis.trashChecks = { confirm: 0, picker: 0, attempts: 0, real: 0, mode: "real" };
    dialog.showMessageBox = async () => { globalThis.trashChecks.confirm++; return { response: 1 }; };
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.trashChecks.picker++;
      return { canceled: false, filePaths: [globalThis.trashChecks.mode === "wrong" ? globalThis.wrongTrashChoice : options.defaultPath] };
    };
    shell.trashItem = async file => {
      const checks = globalThis.trashChecks;
      checks.attempts++;
      if (checks.mode !== "real" && checks.attempts === 1) throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      checks.real++;
      return globalThis.originalTrash(file);
    };
  });
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), files[0]);
  await page.getByRole("region", { name: "Photo gallery", exact: true }).waitFor();
  await page.window.waitForFunction(() => !!window.trashDocument);
  await page.waitForFunction(() => !!document.querySelector(".page canvas"));
  await page.getByRole("button", { name: `View ${names[0]}`, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash…", exact: true }).click();
  await page.getByRole("button", { name: `View ${names[0]}`, exact: true }).waitFor({ state: "detached" });
  assert.equal(existsSync(files[0]), false);
  assert.deepEqual(await app.evaluate(() => globalThis.trashChecks), { confirm: 1, picker: 0, attempts: 1, real: 1, mode: "real" });
  console.log("ok  gallery context menu moves the disposable original with real shell.trashItem");

  await app.evaluate(() => { globalThis.trashChecks = { confirm: 0, picker: 0, attempts: 0, real: 0, mode: "recover" }; });
  const recovered = await page.window.evaluate(async name => window.folioDesktop.content.trash(window.trashDocument.id, name), names[1]);
  assert.equal(recovered.files.includes(names[1]), false);
  assert.equal(existsSync(files[1]), false);
  assert.deepEqual(await app.evaluate(() => globalThis.trashChecks), { confirm: 1, picker: 1, attempts: 2, real: 1, mode: "recover" });
  console.log("ok  permission denial invokes one native picker and one real Trash retry through IPC/preload");

  await app.evaluate(() => {
    globalThis.trashChecks = { confirm: 0, picker: 0, attempts: 0, real: 0, mode: "wrong" };
  });
  // A different, existing image must be rejected without Electron's IPC error prefix leaking to the renderer.
  const other = path.join(folder, "other.png"); writeFileSync(other, png);
  await app.evaluate((_electron, wrong) => { globalThis.wrongTrashChoice = wrong; }, other);
  const failure = await page.window.evaluate(async name => {
    try { await window.folioDesktop.content.trash(window.trashDocument.id, name); return null; }
    catch (error) { return error.message; }
  }, names[2]);
  assert.equal(failure, "Select the same image to allow access. No file was moved.");
  assert.deepEqual(readFileSync(files[2]), png); assert.deepEqual(readFileSync(other), png);
  assert.deepEqual(await app.evaluate(() => globalThis.trashChecks), { confirm: 1, picker: 1, attempts: 1, real: 0, mode: "wrong" });
  await assertHidden(app);
  assert.deepEqual(errors, []);
  console.log("PASS macOS Trash: real native move, bounded recovery, clean IPC error and hidden window");
} finally {
  if (app) await app.close();
  // Exact UUID names only; never list or empty the user's Trash.
  for (const file of trashPaths) {
    if (existsSync(file)) {
      assert.deepEqual(readFileSync(file), png, "refusing to remove an unexpected Trash file");
      rmSync(file);
    }
  }
  rmSync(temp, { recursive: true, force: true });
}
