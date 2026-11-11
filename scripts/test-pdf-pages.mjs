import { closeHidden } from "./hidden-window.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, degrees } from "pdf-lib";

const root = path.resolve(import.meta.dirname, "..");
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom" });
const key = PDFName.of;
const marker = (pdf, page, text) => {
  const annotation = pdf.context.obj({ Type: "Annot", Subtype: "Text", Rect: [5, 5, 25, 25], Contents: PDFString.of(text), P: page.ref });
  page.node.addAnnot(pdf.context.register(annotation));
};
const outlines = (pdf, targets) => {
  const outline = pdf.context.obj({ Type: "Outlines", Count: targets.length });
  const outlineRef = pdf.context.register(outline);
  const items = targets.map((page, index) => {
    const node = pdf.context.obj({ Title: PDFString.of(`Bookmark ${index + 1}`), Parent: outlineRef, Dest: [page.ref, "Fit"] });
    return { node, ref: pdf.context.register(node) };
  });
  items.forEach(({ node }, index) => { if (index) node.set(key("Prev"), items[index - 1].ref); if (index + 1 < items.length) node.set(key("Next"), items[index + 1].ref); });
  outline.set(key("First"), items[0].ref); outline.set(key("Last"), items.at(-1).ref);
  pdf.catalog.set(key("Outlines"), outlineRef);
};
const pageTitles = pdf => {
  const result = [];
  let current = pdf.context.lookup(pdf.catalog.get(key("Outlines")))?.get(key("First"));
  while (current) { const node = pdf.context.lookup(current); result.push([node.get(key("Title")).decodeText(), String(pdf.context.lookup(node.get(key("Dest")))?.get(0))]); current = node.get(key("Next")); }
  return result;
};
try {
  const { changePdfPages, inspectPdfPages } = await server.ssrLoadModule("/src/pdfPages.ts");
  const { inspectPdfPagesInWorker, changePdfPagesInWorker } = await server.ssrLoadModule("/src/pdfPagesWorker.ts");
  const NativeWorker = globalThis.Worker;
  const workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(...args) { this.input = args; }
    terminate() { this.terminated = true; }
  };
  try {
    const input = new Uint8Array([1, 2, 3]), abort = new AbortController();
    const pending = changePdfPagesInWorker(input, { type: "rotate", pages: [0] }, abort.signal);
    assert.equal(workers.at(-1).input.length, 1, "worker request must clone rather than transfer current bytes");
    abort.abort(new Error("in-flight abort"));
    await assert.rejects(pending, /in-flight abort/);
    assert.equal(workers.at(-1).terminated, true);
    assert.deepEqual([...input], [1, 2, 3]);
    const inspecting = inspectPdfPagesInWorker(input, new AbortController().signal);
    workers.at(-1).onmessage({ data: { count: 3 } });
    assert.equal(await inspecting, 3); assert.equal(workers.at(-1).terminated, true);
    const failed = inspectPdfPagesInWorker(input, new AbortController().signal);
    workers.at(-1).onerror();
    await assert.rejects(failed, /processing failed/); assert.equal(workers.at(-1).terminated, true);
    const setTimer = globalThis.setTimeout;
    let expire, duration, timed;
    try {
      globalThis.setTimeout = (callback, ms) => { expire = callback; duration = ms; return 0; };
      timed = inspectPdfPagesInWorker(input, new AbortController().signal);
    } finally { globalThis.setTimeout = setTimer; }
    assert.equal(duration, 60000); expire();
    await assert.rejects(timed, /timed out/); assert.equal(workers.at(-1).terminated, true);
    const before = workers.length;
    await assert.rejects(() => inspectPdfPagesInWorker(input, abort.signal), /in-flight abort/);
    assert.equal(workers.length, before, "pre-aborted request created a worker");
  } finally { globalThis.Worker = NativeWorker; }
  const original = await PDFDocument.create();
  original.addPage([300, 500]); original.addPage([500, 300]); original.addPage([150, 200]).setRotation(degrees(90));
  marker(original, original.getPage(1), "Surviving note");
  marker(original, original.getPage(0), "DELETED_SECRET_MARKER_93517");
  const field = original.getForm().createTextField("Keep field"); field.setText("Keep value"); field.addToPage(original.getPage(1), { x: 50, y: 50, width: 80, height: 20 });
  const removedField = original.getForm().createTextField("Remove field"); removedField.setText("Remove value"); removedField.addToPage(original.getPage(0), { x: 50, y: 50, width: 80, height: 20 });
  outlines(original, original.getPages());
  const named = original.context.obj({ Names: [PDFString.of("deleted"), [original.getPage(0).ref, "Fit"], PDFString.of("kept"), [original.getPage(1).ref, "Fit"]] });
  original.catalog.set(key("Names"), original.context.obj({ Dests: original.context.register(named) }));
  const obsoleteLink = original.context.obj({ Type: "Annot", Subtype: "Link", Rect: [1, 1, 2, 2], Dest: PDFString.of("deleted") });
  original.getPage(1).node.addAnnot(original.context.register(obsoleteLink));
  const bytes = await original.save({ useObjectStreams: false });
  const unchanged = bytes.slice();
  assert.equal(await inspectPdfPages(bytes), 3);
  const blank = await changePdfPages(bytes, { type: "blank", index: 1, matchPage: 2 });
  const withBlank = await PDFDocument.load(blank);
  assert.equal(withBlank.getPageCount(), 4);
  assert.deepEqual(withBlank.getPage(1).getSize(), { width: 150, height: 200 });
  assert.equal(withBlank.getPage(1).getRotation().angle, 90);
  assert.equal(withBlank.getForm().getTextField("Keep field").getText(), "Keep value");
  assert.equal(pageTitles(withBlank)[1][1], String(withBlank.getPage(2).ref));
  const rotated = await PDFDocument.load(await changePdfPages(blank, { type: "rotate", pages: [0, 2, 2] }));
  assert.equal(rotated.getPage(0).getRotation().angle, 90);
  assert.equal(rotated.getPage(2).getRotation().angle, 90);
  const deleted = await changePdfPages(bytes, { type: "delete", pages: [0, 2] });
  const survivor = await PDFDocument.load(deleted);
  assert.equal(survivor.getPageCount(), 1);
  assert.deepEqual(survivor.getPage(0).getSize(), { width: 500, height: 300 });
  assert.equal(survivor.getForm().getTextField("Keep field").getText(), "Keep value");
  assert.deepEqual(survivor.getForm().getFields().map(field => field.getName()), ["Keep field"]);
  assert.deepEqual(pageTitles(survivor), [["Bookmark 2", String(survivor.getPage(0).ref)]]);
  const survivingNames = survivor.context.lookup(survivor.context.lookup(survivor.catalog.get(key("Names"))).get(key("Dests"))).lookup(key("Names"));
  assert.equal(survivingNames.size(), 2); assert.equal(survivingNames.get(0).decodeText(), "kept");
  const annotations = survivor.getPage(0).node.Annots().asArray().map(ref => survivor.context.lookup(ref));
  assert.ok(annotations.some(annotation => annotation.get(key("Contents"))?.decodeText() === "Surviving note"));
  assert.ok(!annotations.some(annotation => annotation.has(key("Dest"))), "link to deleted page survived");
  assert.ok(!survivor.context.enumerateIndirectObjects().some(([, object]) => object.toString().includes("DELETED_SECRET_MARKER_93517")), "removed content remained in orphan objects");
  const source = await PDFDocument.create(); source.addPage([320, 140]).setRotation(degrees(270)); marker(source, source.getPage(0), "Inserted mark"); outlines(source, source.getPages());
  const sourceBytes = await source.save();
  const inserted = await PDFDocument.load(await changePdfPages(bytes, { type: "insert", index: 1, bytes: sourceBytes }));
  assert.equal(inserted.getPageCount(), 4); assert.equal(inserted.getPage(1).getRotation().angle, 270);
  assert.deepEqual(inserted.getPage(1).getSize(), { width: 320, height: 140 });
  const insertedNote = inserted.context.lookup(inserted.getPage(1).node.Annots().get(0));
  assert.equal(insertedNote.get(key("Contents")).decodeText(), "Inserted mark");
  assert.equal(String(insertedNote.get(key("P"))), String(inserted.getPage(1).ref));
  assert.equal(pageTitles(inserted).length, 3);
  assert.equal(inserted.getForm().getTextField("Keep field").getText(), "Keep value");
  assert.deepEqual(bytes, unchanged, "operation mutated original/Undo snapshot");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3, "Undo snapshot cannot restore pages");
  for (const bad of [new Uint8Array(), new TextEncoder().encode("broken"), new TextEncoder().encode("%PDF-1.7\ntruncated")]) await assert.rejects(() => inspectPdfPages(bad), /empty|valid|damaged/);
  await assert.rejects(() => inspectPdfPages({ byteLength: 301 * 1024 * 1024 }), /300 MB/);
  await assert.rejects(() => changePdfPages(bytes, { type: "delete", pages: [0, 1, 2] }), /at least one/);
  for (const pages of [[], [-1], [3], [NaN]]) await assert.rejects(() => changePdfPages(bytes, { type: "delete", pages }), /existing pages/);
  await assert.rejects(() => changePdfPages(bytes, { type: "blank", index: 9, matchPage: 0 }), /insertion position/);
  await assert.rejects(() => changePdfPages(bytes, { type: "blank", index: 0, matchPage: -1 }), /page size/);
  await assert.rejects(() => changePdfPages(bytes, { type: "insert", index: 0, bytes }), /form fields/);
  const linkSource = await PDFDocument.create(); linkSource.addPage();
  linkSource.getPage(0).node.addAnnot(linkSource.context.register(linkSource.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 1, 1], Dest: [linkSource.getPage(0).ref, "Fit"] })));
  const copiedLink = await PDFDocument.load(await changePdfPages(bytes, { type: "insert", index: 0, bytes: await linkSource.save() }));
  assert.equal(String(copiedLink.context.lookup(copiedLink.getPage(0).node.Annots().get(0)).lookup(key("Dest")).get(0)), String(copiedLink.getPage(0).ref), "self link points to a detached imported page");
  const navigation = await PDFDocument.create(); navigation.addPage(); navigation.addPage(); navigation.addPage();
  marker(navigation, navigation.getPage(0), "DELETED_ACTION_TARGET");
  const deadGoTo = navigation.context.register(navigation.context.obj({ S: "GoTo", D: [navigation.getPage(0).ref, "Fit"] }));
  const liveGoTo = navigation.context.register(navigation.context.obj({ S: "GoTo", D: [navigation.getPage(2).ref, "Fit"] }));
  navigation.catalog.set(key("OpenAction"), navigation.context.obj({ S: "Named", N: "NextPage", Next: deadGoTo }));
  navigation.getPage(1).node.set(key("AA"), navigation.context.obj({
    O: { S: "Named", N: "NextPage", Next: [deadGoTo, liveGoTo] },
    C: { S: "GoTo", D: [navigation.getPage(0).ref, "Fit"], Next: liveGoTo },
  }));
  const cleanNavigation = await PDFDocument.load(await changePdfPages(await navigation.save(), { type: "delete", pages: [0] }));
  assert.equal(cleanNavigation.getPageCount(), 2);
  assert.equal(cleanNavigation.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.get(key("Type")) === key("Page")).length, 2, "chained or additional action retained deleted page");
  assert.equal(cleanNavigation.context.lookup(cleanNavigation.catalog.get(key("OpenAction"))).has(key("Next")), false);
  const actions = cleanNavigation.context.lookup(cleanNavigation.getPage(0).node.get(key("AA")));
  const liveNext = cleanNavigation.context.lookup(cleanNavigation.context.lookup(actions.get(key("O"))).get(key("Next")));
  assert.equal(liveNext.size(), 1, "surviving action chain was lost");
  assert.equal(String(cleanNavigation.context.lookup(liveNext.get(0)).lookup(key("D")).get(0)), String(cleanNavigation.getPage(1).ref));
  assert.equal(String(cleanNavigation.context.lookup(actions.get(key("C"))).lookup(key("D")).get(0)), String(cleanNavigation.getPage(1).ref), "surviving next action was not promoted");
  const cyclicAction = navigation.context.obj({ S: "Named", N: "NextPage" });
  const cyclicRef = navigation.context.register(cyclicAction); cyclicAction.set(key("Next"), cyclicRef); navigation.catalog.set(key("OpenAction"), cyclicRef);
  await assert.rejects(async () => changePdfPages(await navigation.save(), { type: "delete", pages: [0] }), /cyclic action/);
  const signed = await PDFDocument.create(); signed.addPage(); signed.catalog.set(key("TestSignature"), signed.context.register(signed.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3] })));
  await assert.rejects(async () => inspectPdfPages(await signed.save()), /signatures/);
  const encrypted = await PDFDocument.create(); encrypted.addPage(); encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: "Standard" }));
  await assert.rejects(async () => inspectPdfPages(await encrypted.save()), /Encrypted/);
  const tagged = await PDFDocument.create(); tagged.addPage(); tagged.catalog.set(key("StructTreeRoot"), tagged.context.obj({ Type: "StructTreeRoot" }));
  const taggedBytes = await tagged.save();
  const copiedTagged = await PDFDocument.load(await changePdfPages(bytes, { type: "insert", index: 0, bytes: taggedBytes }));
  assert.equal(copiedTagged.getPageCount(), 4);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => changePdfPages(bytes, { type: "rotate", pages: [0] }, controller.signal), /abort/i);
  const sample = new Uint8Array(readFileSync(path.join(root, "public/sample.pdf")));
  const sampleCount = await inspectPdfPages(sample);
  const sampleInserted = await changePdfPages(sample, { type: "insert", index: 1, bytes: sourceBytes });
  const sampleDeleted = await changePdfPages(sampleInserted, { type: "delete", pages: [1] });
  assert.equal((await PDFDocument.load(sampleDeleted)).getPageCount(), sampleCount);
  assert.deepEqual(pageTitles(await PDFDocument.load(sampleDeleted)), pageTitles(await PDFDocument.load(sample)));
  const sampleRemoved = await changePdfPages(sample, { type: "delete", pages: [0] });
  const taggedSurvivor = await PDFDocument.load(sampleRemoved);
  assert.equal(taggedSurvivor.getPageCount(), sampleCount - 1);
  assert.equal(taggedSurvivor.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.get(key("Type")) === key("Page")).length, sampleCount - 1, "tag tree retained a deleted page object");
  const brandbook = new Uint8Array(readFileSync(path.join(root, "brand/doko/brandbook.pdf")));
  const brandbookCount = await inspectPdfPages(brandbook);
  assert.equal((await PDFDocument.load(await changePdfPages(brandbook, { type: "delete", pages: [0] }))).getPageCount(), brandbookCount - 1);
  for (const importedBytes of [sample, brandbook]) {
    const importedCount = await inspectPdfPages(importedBytes);
    const merged = await PDFDocument.load(await changePdfPages(bytes, { type: "insert", index: 1, bytes: importedBytes }));
    assert.equal(merged.getPageCount(), 3 + importedCount);
    assert.equal(merged.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.get(key("Type")) === key("Page")).length, merged.getPageCount(), "import created detached page copies");
    for (const page of merged.getPages().slice(1, importedCount + 1)) assert.equal(page.node.has(key("StructParents")), false, "imported tag index still points into source structure tree");
  }
  const linked = await PDFDocument.create(); linked.addPage([320, 140]); linked.addPage([140, 320]);
  linked.catalog.set(key("Dests"), linked.context.obj({ legacy: [linked.getPage(1).ref, "Fit"] }));
  linked.catalog.set(key("Names"), linked.context.obj({ Dests: { Names: [PDFString.of("modern"), { D: [linked.getPage(0).ref, "Fit"] }] } }));
  linked.getPage(0).node.addAnnot(linked.context.register(linked.context.obj({ Type: "Annot", Subtype: "Link", Rect: [1, 1, 10, 10], P: linked.getPage(0).ref, Dest: [linked.getPage(1).ref, "Fit"] })));
  linked.getPage(0).node.addAnnot(linked.context.register(linked.context.obj({ Type: "Annot", Subtype: "Link", Rect: [20, 20, 30, 30], Dest: key("legacy") })));
  linked.getPage(1).node.set(key("AA"), linked.context.obj({ O: { S: "Named", N: "NextPage", Next: [{ S: "GoTo", D: PDFString.of("modern") }] } }));
  const mergedLinks = await PDFDocument.load(await changePdfPages(bytes, { type: "insert", index: 1, bytes: await linked.save() }));
  assert.equal(mergedLinks.getPageCount(), 5);
  assert.equal(mergedLinks.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.get(key("Type")) === key("Page")).length, 5, "link targets retained detached page copies");
  const links = mergedLinks.getPage(1).node.Annots().asArray().map(ref => mergedLinks.context.lookup(ref));
  assert.ok(links.every(link => String(link.lookup(key("Dest")).get(0)) === String(mergedLinks.getPage(2).ref)), "direct or named link target was not remapped");
  assert.equal(String(links[0].get(key("P"))), String(mergedLinks.getPage(1).ref), "annotation parent points to a detached page");
  const chained = mergedLinks.context.lookup(mergedLinks.context.lookup(mergedLinks.getPage(2).node.get(key("AA"))).get(key("O"))).lookup(key("Next"));
  assert.equal(String(mergedLinks.context.lookup(chained.get(0)).lookup(key("D")).get(0)), String(mergedLinks.getPage(1).ref), "named /AA/Next target was not remapped");
  console.log("PASS PDF pages: insert/blank/delete/multiselect/rotation, mixed dimensions, marks, bookmarks/named links, forms, removal of orphan content, original/Undo fidelity, sample/brandbook tagged imports, direct/named/AA/Next links with no detached pages, sample.pdf round trip, invalid/empty/corrupt/encrypted/signed/form-source/abort guards, worker timeout/crash/abort disposal and input preservation");
} finally { await server.close(); }

if (process.argv.includes("--ui")) {
  const { _electron: electron } = await import("playwright-core");
  const { electronPath } = await import("./electron-path.mjs");
  const { readerPage } = await import("./reader-page.mjs");
  const { assertHidden } = await import("./hidden-window.mjs");
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const temp = mkdtempSync(path.join(tmpdir(), "doko-pages-"));
  const shots = path.join(root, "release/smoke"); mkdirSync(shots, { recursive: true });
  const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
  try {
    const page = readerPage(await app.firstWindow());
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.getByRole("button", { name: /Try a sample/ }).click({ timeout: 30_000 });
    await page.locator(".page canvas").first().waitFor();
    const initial = Number((await page.locator(".page-total").innerText()).replace(/\D/g, ""));
    await page.locator(".sidebar-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    const bookmark = page.getByRole("button", { name: `Bookmark page ${initial}`, exact: true });
    if (await bookmark.getAttribute("aria-pressed") !== "true") await bookmark.click();
    const open = async (count = initial) => {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Organize pages…", exact: true }).click();
      await ready(count);
    };
    const dialog = page.getByRole("dialog", { name: "Manage pages", exact: true });
    const ready = async count => page.waitForFunction(count => document.querySelectorAll(".pdf-pages-page").length === count && [...document.querySelectorAll(".pdf-pages-tools button")].some(button => button.textContent === "Blank page" && !button.disabled), count);
    const check = async count => { await ready(count); assert.equal(await dialog.getByRole("checkbox").count(), count); };
    await open();
    assert.equal(await dialog.getByRole("button", { name: "Apply changes" }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Blank page", exact: true }).click(); await check(initial + 1);
    await dialog.getByRole("button", { name: "Undo", exact: true }).click(); await check(initial);
    await dialog.getByRole("checkbox", { name: "Select page 1", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "Select page 3", exact: true }).check();
    await dialog.getByRole("button", { name: "Delete selected", exact: true }).click(); await check(initial - 2);
    await dialog.getByRole("button", { name: "Undo", exact: true }).click(); await check(initial);
    await dialog.getByRole("button", { name: "Select all", exact: true }).click();
    assert.equal(await dialog.getByRole("button", { name: "Delete selected", exact: true }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Clear selection", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "Select page 2", exact: true }).check();
    await page.evaluate(() => {
      const send = Worker.prototype.postMessage;
      window.previewReloadEnabled = [];
      window.restorePreviewWorker = () => { Worker.prototype.postMessage = send; };
      Worker.prototype.postMessage = function(message, ...options) {
        if (message?.bytes && message.change === undefined) {
          window.previewReloadEnabled.push([...document.querySelectorAll(".pdf-pages-tools button")]
            .some(button => button.textContent === "Blank page" && !button.disabled));
        }
        return send.call(this, message, ...options);
      };
    });
    await dialog.getByRole("button", { name: "Rotate 90°", exact: true }).click(); await check(initial);
    const reloadEnabled = await page.evaluate(() => { window.restorePreviewWorker(); return window.previewReloadEnabled; });
    assert.ok(reloadEnabled.length > 0, "Rotation must inspect the changed PDF");
    assert.ok(reloadEnabled.every(enabled => !enabled), "Old page controls must stay disabled when preview reload starts");
    await dialog.getByRole("button", { name: "Undo", exact: true }).click(); await check(initial);
    await dialog.locator('input[type="file"]').setInputFiles({ name: "corrupt.pdf", mimeType: "application/pdf", buffer: Buffer.from("invalid") });
    await dialog.getByRole("alert").getByText("Choose a valid PDF file.", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("checkbox").count(), initial);
    assert.equal(await dialog.getByRole("button", { name: "Apply changes" }).isDisabled(), true);
    const imported = await PDFDocument.create(); imported.addPage([320, 140]);
    await dialog.locator('input[type="file"]').setInputFiles({ name: "extra.pdf", mimeType: "application/pdf", buffer: Buffer.from(await imported.save()) });
    await check(initial + 1);
    // PDF.js paints thumbnails after the page controls become ready. Let the screenshot capture their final paint.
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, "pdf-pages-desktop.png") });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Manage pages"]'));
    assert.equal(await page.locator(".page-total").innerText(), `of ${initial}`);
    await open();
    await dialog.getByRole("checkbox", { name: "Select page 2", exact: true }).check();
    await dialog.getByRole("button", { name: "Blank page", exact: true }).click(); await check(initial + 1);
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(320, 400); window.setSize(390, 844); });
    await page.window.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => window.innerWidth <= 390);
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, "page dialog overflows narrow screen");
    assert.equal(await dialog.getByRole("button", { name: "Apply changes", exact: true }).evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }), true, "Apply action is outside the mobile viewport");
    await page.screenshot({ path: path.join(shots, "pdf-pages-mobile.png") });
    await dialog.getByRole("button", { name: "Apply changes", exact: true }).click();
    await page.waitForFunction(count => !document.querySelector('[role="dialog"][aria-label="Manage pages"]') && document.querySelector(".page-total")?.textContent === `of ${count}`, initial + 1);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
    await page.window.setViewportSize({ width: 1000, height: 800 });
    await page.waitForFunction(() => innerWidth > 760);
    await page.locator(".sidebar-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.equal(await page.getByRole("button", { name: `Bookmark page ${initial + 1}`, exact: true }).getAttribute("aria-pressed"), "true", "reading bookmark was not remapped after insertion");
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await page.getByRole("textbox", { name: "Notes about this document", exact: true }).fill("NEW NOTE AFTER EDIT");
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await page.locator(".sidebar-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.getByRole("button", { name: "Bookmark page 4", exact: true }).click();
    await page.getByRole("button", { name: "Bookmark page 3", exact: true }).click();
    await page.getByRole("button", { name: "Undo document edit", exact: true }).click();
    await page.waitForFunction(count => document.querySelector(".page-total")?.textContent === `of ${count}`, initial);
    await page.locator(".sidebar-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.equal(await page.getByRole("button", { name: `Bookmark page ${initial}`, exact: true }).getAttribute("aria-pressed"), "true", "parent Undo lost the reading bookmark");
    assert.equal(await page.getByRole("button", { name: "Bookmark page 3", exact: true }).getAttribute("aria-pressed"), "true", "parent Undo lost the newly added bookmark on a surviving page");
    await page.getByRole("tab", { name: /^Notes/ }).click();
    assert.equal(await page.getByRole("textbox", { name: "Notes about this document", exact: true }).inputValue(), "NEW NOTE AFTER EDIT", "parent Undo lost the newer document note");
    const target = await PDFDocument.create(); target.addPage().drawText("IMPORT TARGET"); target.addPage();
    await app.evaluate(({ BrowserWindow }, bytes) => BrowserWindow.getAllWindows()[0].webContents.send("folio:open-file", { name: "Import target.pdf", data: Buffer.from(bytes) }), [...await target.save()]);
    await page.window.waitForFunction(() => document.title.startsWith("Import target.pdf"));
    await page.waitForFunction(() => document.querySelector(".page-total")?.textContent === "of 2");
    await open(2);
    await dialog.locator('input[type="file"]').setInputFiles(path.join(root, "public/sample.pdf"));
    await check(2 + initial);
    await dialog.getByRole("button", { name: "Apply changes", exact: true }).click();
    await page.waitForFunction(count => !document.querySelector('[role="dialog"][aria-label="Manage pages"]') && document.querySelector(".page-total")?.textContent === `of ${count}`, 2 + initial);
    await page.getByRole("textbox", { name: "Page number", exact: true }).fill("3");
    await page.getByRole("textbox", { name: "Page number", exact: true }).press("Enter");
    await page.locator('.page[data-page-number="3"] .textLayer').getByText("Getting around", { exact: true }).waitFor();
    // Observe real worker entry without replacing its PDF processing implementation.
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      window.__pageWorkers = [];
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          if (!String(url).includes("pdfPages.worker")) { super(url, options); return; }
          const script = URL.createObjectURL(new Blob([`import ${JSON.stringify(String(url))}; const handle = self.onmessage; self.onmessage = event => { self.postMessage({ testStarted: true }); return handle(event); };`], { type: "text/javascript" }));
          super(script, options); URL.revokeObjectURL(script);
          const record = { started: false, terminated: false }; window.__pageWorkers.push(record);
          this.addEventListener("message", event => { if (event.data.testStarted) { record.started = true; event.stopImmediatePropagation(); } });
          const terminate = this.terminate.bind(this);
          this.terminate = () => { record.terminated = true; terminate(); };
        }
      };
    });
    await open(2 + initial);
    const heavy = await PDFDocument.create(); heavy.addPage();
    for (let index = 0; index < 60000; index++) heavy.context.register(heavy.context.obj({ Stress: index, Value: PDFString.of("worker abort fixture") }));
    await dialog.locator('input[type="file"]').setInputFiles({ name: "heavy.pdf", mimeType: "application/pdf", buffer: Buffer.from(await heavy.save({ useObjectStreams: false })) });
    await page.waitForFunction(() => window.__pageWorkers.at(-1)?.started && !window.__pageWorkers.at(-1).terminated);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__pageWorkers.at(-1).terminated), false, "fixture completed before in-flight abort");
    await dialog.getByRole("button", { name: "Stop", exact: true }).click({ timeout: 2000 });
    await dialog.getByRole("alert").getByText("Page change stopped. Your edits are unchanged.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__pageWorkers.at(-1).terminated), true, "Stop did not terminate the active worker");
    await check(2 + initial);
    assert.equal(await dialog.getByRole("button", { name: "Apply changes" }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Blank page", exact: true }).click(); await check(3 + initial);
    await dialog.getByRole("button", { name: "Undo", exact: true }).click(); await check(2 + initial);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const many = await PDFDocument.create();
    for (let index = 0; index < 120; index++) many.addPage([300, 400]);
    await app.evaluate(({ BrowserWindow }, bytes) => BrowserWindow.getAllWindows()[0].webContents.send("folio:open-file", { name: "Thumbnail lifecycle.pdf", data: Buffer.from(bytes) }), [...await many.save()]);
    await page.window.waitForFunction(() => document.title.startsWith("Thumbnail lifecycle.pdf"));
    await page.waitForFunction(() => document.querySelector(".page-total")?.textContent === "of 120");
    await open(120);
    await page.waitForFunction(() => document.querySelector(".pdf-pages-page canvas")?.width > 0);
    await page.evaluate(() => { window.__firstThumbnail = document.querySelector(".pdf-pages-page canvas"); const grid = document.querySelector(".pdf-pages-grid"); grid.scrollTop = grid.scrollHeight; });
    await page.waitForFunction(() => window.__firstThumbnail.width === 0 && !window.__firstThumbnail.isConnected);
    assert.ok(await dialog.locator("canvas").count() < 60, "offscreen thumbnail canvases accumulated");
    await dialog.locator(".pdf-pages-grid").evaluate(grid => { grid.scrollTop = 0; });
    await page.waitForFunction(() => { const canvas = document.querySelector(".pdf-pages-page canvas"); return canvas && canvas !== window.__firstThumbnail && canvas.width > 0; });
    for (let index = 0; index < 4; index++) {
      await dialog.locator(".pdf-pages-grid").evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
      await page.waitForTimeout(20);
      await dialog.locator(".pdf-pages-grid").evaluate(grid => { grid.scrollTop = 0; });
      await page.waitForTimeout(20);
    }
    await page.waitForFunction(() => document.querySelector(".pdf-pages-page canvas")?.width > 0);
    assert.equal(await dialog.getByText("Preview unavailable", { exact: true }).count(), 0, "thumbnail reentry failed");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(errors, []);
    await assertHidden(app);
    console.log("PASS PDF pages UI: sample insert/blank/multiselect delete/rotate/Undo, prevent zero pages, invalid import recovery, Cancel unchanged, Apply and parent Undo with newer notes/bookmarks, tagged sample import and visible text, 390px layout, real in-flight worker abort/recovery, offscreen bitmap release/reentry, hidden Electron");
  } finally { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }); await closeHidden(app); rmSync(temp, { recursive: true, force: true }); }
}
