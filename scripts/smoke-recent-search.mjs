import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createServer } from "vite";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, ".."), temp = mkdtempSync(path.join(tmpdir(), "doko-recent-search-"));
const server = await createServer({ root, cacheDir: path.join(temp, "vite"), logLevel: "error", plugins: [{ name: "old-recent-fixture", transform(source, id) {
  if (id.endsWith("/src/recent.ts?old-schema")) return source.replace('const DB_NAME = "folio"', 'const DB_NAME = "folio-old-fixture"');
} }], server: { host: "127.0.0.1", port: 0 } });
let app;
try {
  await server.listen();
  const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1", FOLIO_DEV_URL: server.resolvedUrls.local[0] };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
  const window = await app.firstWindow(), page = readerPage(window), errors = [];
  window.on("pageerror", error => errors.push(String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Recent metadata fixture", { font });
  await page.evaluate(async bytes => {
    const r = await import("/src/recent.ts");
    for (let n = 0; n < 10; n++) await r.saveRecent({ id: `fixture-${n}`, name: `Fixture ${n}.pdf`, size: bytes.length, pages: 1,
      openedAt: n, lastPage: 1, thumb: "", data: new Blob([new Uint8Array(bytes)]) });
    const list = await r.listRecent();
    if (list.length !== 8 || list[0].id !== "fixture-9" || list.some(row => "data" in row)) throw new Error("Metadata list or eviction is incorrect");
    if (await r.getRecent("fixture-0")) throw new Error("Eviction retained the PDF");
    if ((await r.getRecent("fixture-9")).data.size !== bytes.length) throw new Error("Lazy PDF read failed");
    await r.updateLastPage("fixture-9", 2);
    if ((await r.listRecent())[0].lastPage !== 2) throw new Error("Metadata lost reading position");
    const db = await r.openFolioDatabase();
    const stores = [];
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) { stores.push(this.name); return getAll.apply(this, args); };
    try { await r.listRecent(); await r.saveRecent(await r.getRecent("fixture-9")); }
    finally { IDBObjectStore.prototype.getAll = getAll; }
    if (stores.includes("recent")) throw new Error("Listing/eviction loaded PDF payloads");
    window.parent.recentAuditReads = stores;
    // The old schema contains the original bytes, notes and position before metadata exists.
    const request = indexedDB.open("folio-old-fixture", 7);
    request.onupgradeneeded = () => {
      for (const name of ["recent", "notes", "ai"]) request.result.createObjectStore(name, { keyPath: "id" });
      for (const name of ["recentPositions", "clearGenerations"]) request.result.createObjectStore(name);
    };
    const old = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = old.transaction(["recent", "recentPositions", "notes"], "readwrite");
      tx.objectStore("recent").put({ id: "old", name: "Old.pdf", data: new Blob(["ORIGINAL"]), size: 8, pages: 3, openedAt: 10, lastPage: 1, thumb: "" });
      tx.objectStore("recentPositions").put(3, "old");
      tx.objectStore("notes").put({ id: "old", note: "KEEP NOTE", marks: [] });
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    old.close();
    const migrated = await import("/src/recent.ts?old-schema");
    const [card] = await migrated.listRecent();
    if (card.lastPage !== 3 || "data" in card || (await migrated.getRecent("old")).data.size !== 8
      || (await migrated.getNotes("old")).value.note !== "KEEP NOTE") throw new Error("v7 metadata migration lost existing data");
  }, [...await pdf.save()]);
  await window.reload();
  await page.locator(".recent-card").first().waitFor();
  assert.equal(await page.locator(".recent-card").count(), 8);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    window.failRecentDelete = true;
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === "recent" && window.failRecentDelete) { this.transaction.abort(); return {}; }
      return original.apply(this, args);
    };
  });
  await page.getByTitle("Remove from recent", { exact: true }).first().click();
  const confirmation = page.getByRole("dialog", { name: "Remove recent files" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === "Cancel", undefined, { timeout: 3000 }).catch(async error => {
    console.log(await page.evaluate(() => ({ active: document.activeElement?.outerHTML, panels: [...document.querySelectorAll('.recent-confirm:popover-open')].map(el => ({ html: el.outerHTML, visibility: getComputedStyle(el).visibility, autofocus: el.querySelector('[autofocus]')?.outerHTML })) })));
    throw error;
  });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".recent-card").count(), 8);
  await page.getByTitle("Remove from recent", { exact: true }).first().click();
  await confirmation.getByRole("button", { name: "Remove (1)", exact: true }).click();
  await page.getByRole("alert").getByText(/Couldn't remove/).waitFor();
  assert.equal(await page.locator(".recent-card").count(), 8);
  mkdirSync(path.join(root, "release/smoke"), { recursive: true });
  await page.screenshot({ path: path.join(root, "release/smoke/recent-delete-error.png") });
  await page.evaluate(() => { window.failRecentDelete = false; });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".recent-card").length === 7);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.clear;
    window.failRecentClear = true;
    IDBObjectStore.prototype.clear = function (...args) {
      if (this.name === "recent" && window.failRecentClear) { this.transaction.abort(); return {}; }
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await confirmation.getByRole("button", { name: "Remove (7)", exact: true }).click();
  await page.getByRole("alert").getByText(/Couldn't remove/).waitFor();
  assert.equal(await page.locator(".recent-card").count(), 7);
  await page.evaluate(() => { window.failRecentClear = false; });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".recent-card").length === 0);
  await window.reload();
  await page.getByRole("button", { name: /Try a sample/ }).waitFor();
  assert.equal(await page.locator(".recent-card").count(), 0);
  await page.evaluate(async () => {
    const { PDFFindController } = await import("/src/viewer.ts");
    const original = PDFFindController.prototype.setDocument;
    PDFFindController.prototype.setDocument = function (...args) { window.auditFind = this; return original.apply(this, args); };
  });
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator(".page canvas").first().waitFor();
  await page.getByRole("button", { name: /^Search \(/ }).click();
  const query = page.getByRole("textbox", { name: "Find in document" });
  await query.waitFor();
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.auditFind._extractTextPromises.length), 0, "Opening empty search must not index PDF");
  await query.fill("the");
  await page.waitForFunction(() => window.auditFind.pageMatches?.some(row => row?.length));
  await query.fill("");
  await page.waitForFunction(() => window.auditFind.pageMatches.every(row => !row?.length));
  assert.deepEqual(errors, []);
  await assertHidden(app);
  console.log("PASS Recent: metadata-only list/prune, 8-file limit, lazy Blob read, v7 migration preserves bytes/notes/position, aborted single/all deletion retains cards, Cancel/Escape and retry persist. Search: initial empty query extracts zero pages; real query works and clearing removes matches.");
} finally {
  if (app) await closeHidden(app);
  await server.close();
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
