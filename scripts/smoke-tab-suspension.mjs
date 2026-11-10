import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createServer } from "vite";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, ".."), temp = mkdtempSync(path.join(tmpdir(), "doko-tab-suspension-"));
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
let app;
try {
  await server.listen();
  const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1", FOLIO_DEV_URL: server.resolvedUrls.local[0] };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
  const window = await app.firstWindow(), page = readerPage(window);
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) pdf.addPage().drawText(`Suspension page ${i}`, { font, size: 18 });
  const first = await page.evaluate(data => window.frameElement.readerContext.tabs.open([{ kind: "bytes", name: "Suspend.pdf", data: new Uint8Array(data) }]), [...await pdf.save()]);
  await page.getByRole("textbox", { name: "Page number" }).waitFor();
  await page.waitForFunction(async () => (await (await import("/src/recent.ts")).listRecent()).length === 1);
  const sidebar = page.getByRole("button", { name: /Toggle sidebar/ });
  if (await sidebar.getAttribute("aria-pressed") === "false") await sidebar.click();
  await page.getByRole("tab", { name: /^Notes/ }).click();
  await page.getByRole("textbox", { name: "Notes about this document" }).fill("KEEP SUSPENDED NOTE");
  await page.getByRole("textbox", { name: "Page number" }).fill("2");
  await page.getByRole("textbox", { name: "Page number" }).press("Enter");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Page number"]').value === "2");
  await page.evaluate(async () => {
    const tabs = window.frameElement.readerContext.tabs, tab = tabs.all.find(tab => tab.key === tabs.active);
    const r = await import("/src/recent.ts");
    await r.saveAiHistory(tab.contentId, [{ role: "user", content: "KEEP SUSPENDED CHAT" }], 0);
    window.parent.suspensionTabs = tabs;
    tabs.library();
  });
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  assert.equal(await window.evaluate(async first => {
    const tabs = window.suspensionTabs, tab = tabs.all.find(tab => tab.key === first);
    if (tab.suspendTimer === undefined) throw new Error("Inactive tab did not schedule suspension");
    await tabs.suspend(tab);
    return !tab.frame && !tab.reader && tab.source?.kind === "blob";
  }, first), true);
  await window.evaluate(first => window.suspensionTabs.select(first), first);
  await page.getByRole("textbox", { name: "Page number" }).waitFor();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Page number"]').value === "2");
  await page.getByRole("tab", { name: /^Notes/ }).click();
  assert.equal(await page.getByRole("textbox", { name: "Notes about this document" }).inputValue(), "KEEP SUSPENDED NOTE");
  assert.equal(await page.evaluate(async () => {
    const tabs = window.frameElement.readerContext.tabs, tab = tabs.all.find(tab => tab.key === tabs.active);
    return (await (await import("/src/recent.ts")).getAiHistory(tab.contentId)).messages[0].content;
  }), "KEEP SUSPENDED CHAT");
  await page.evaluate(() => window.frameElement.readerContext.tabs.library());
  assert.equal(await window.evaluate(async first => {
    const tabs = window.suspensionTabs, tab = tabs.all.find(tab => tab.key === first);
    const suspend = tab.reader.suspend, frame = tab.frame;
    tab.reader.suspend = async () => { throw new Error("Synthetic storage failure"); };
    await tabs.suspend(tab);
    tab.reader.suspend = suspend;
    return tab.frame === frame && !!tab.reader;
  }, first), true, "Storage failures must retain the live reader");
  assert.equal(await window.evaluate(async first => {
    const tabs = window.suspensionTabs, tab = tabs.all.find(tab => tab.key === first);
    const suspend = tab.reader.suspend, frame = tab.frame;
    let finish;
    tab.reader.suspend = () => new Promise(resolve => { finish = resolve; });
    const pending = tabs.suspend(tab);
    tabs.select(first);
    finish({ kind: "sample", name: "Synthetic stale snapshot" });
    await pending;
    tab.reader.suspend = suspend;
    return tab.frame === frame && !!tab.reader;
  }, first), true, "Selecting a tab during suspension must retain its live reader");
  await page.evaluate(() => window.frameElement.readerContext.tabs.library());
  assert.equal(await window.evaluate(async first => {
    const tabs = window.suspensionTabs, tab = tabs.all.find(tab => tab.key === first);
    tabs.markDirty(first, true);
    const frame = tab.frame;
    await tabs.suspend(tab);
    tabs.markDirty(first, false);
    return tab.frame === frame && !!frame;
  }, first), true, "Unsaved PDF must remain alive");
  await window.evaluate(first => window.suspensionTabs.select(first), first);
  await page.getByRole("textbox", { name: "Page number" }).waitFor();
  const saved = path.join(temp, "saved.pdf");
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    globalThis.suspensionSaveChoices = 0;
    dialog.showSaveDialog = async () => { globalThis.suspensionSaveChoices++; return { canceled: false, filePath: file }; };
    BrowserWindow.getAllWindows()[0].webContents.send("folio:file-command", "save");
  }, saved);
  for (let tries = 0; !existsSync(saved); tries++) {
    assert.ok(tries < 100, "Native Save did not create the PDF");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await page.waitForFunction(() => !document.querySelector(".topbar-center[inert]"));
  await page.evaluate(() => window.frameElement.readerContext.tabs.library());
  assert.equal(await window.evaluate(async first => {
    const tabs = window.suspensionTabs, tab = tabs.all.find(tab => tab.key === first), frame = tab.frame;
    await tabs.suspend(tab);
    return tab.frame === frame && !!tab.reader;
  }, first), true, "Saved PDF must retain its native save location and conflict baseline");
  await window.evaluate(first => window.suspensionTabs.select(first), first);
  await page.getByRole("textbox", { name: "Page number" }).waitFor();
  const savedTime = statSync(saved).mtimeMs;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("folio:file-command", "save"));
  for (let tries = 0; statSync(saved).mtimeMs === savedTime; tries++) {
    assert.ok(tries < 100, "Repeated Save did not update its native PDF");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await page.waitForFunction(() => !document.querySelector(".topbar-center[inert]"));
  assert.equal(await app.evaluate(() => globalThis.suspensionSaveChoices), 1, "Repeated Save must reuse the first native location");
  await assertHidden(app);
  console.log("PASS inactive PDF suspension: iframe released; page, notes and AI restored; dirty tab, storage failure, reselect race and saved native location retain reader; hidden app");
} finally {
  if (app) await closeHidden(app);
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}
