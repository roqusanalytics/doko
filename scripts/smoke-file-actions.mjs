// Native File menu handlers drive the active reader. Dialogs and Trash are mocked only in the isolated test app.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = realpathSync(mkdtempSync(path.join(tmpdir(), "folio-file-actions-")));
const photos = path.join(temp, "Photos"); mkdirSync(photos);
const shots = path.join(root, "release", "smoke"); mkdirSync(shots, { recursive: true });
const pdfPath = path.join(temp, "fixture.pdf"), savedPdf = path.join(temp, "saved.pdf");
const markdown = path.join(temp, "notes.md");
const pdf = await PDFDocument.create(); pdf.addPage([600, 800]);
const originalPdf = await pdf.save(); writeFileSync(pdfPath, originalPdf);
writeFileSync(markdown, "# File menu notes\n\nA **bold** paragraph with $x^2$.\n\n$$\ny=2x\n$$\n");
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env, args: [process.env.FOLIO_FILE_ACTIONS_APP || root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const page = readerPage(await app.firstWindow());
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  await app.evaluate(({ dialog, shell }, temp) => {
    globalThis.fileActionTest = { queue: [], dialogs: [], trash: [], answer: 0, confirmations: [] };
    dialog.showSaveDialog = async (_window, options) => {
      const state = globalThis.fileActionTest;
      state.dialogs.push(options.defaultPath);
      if (!state.queue.length) throw new Error("Unexpected Save dialog");
      const filePath = state.queue.shift();
      if (filePath && !filePath.startsWith(temp)) throw new Error("Test tried saving outside its fixture directory");
      return { canceled: !filePath, filePath: filePath || undefined };
    };
    dialog.showMessageBox = async (_window, options) => {
      globalThis.fileActionTest.confirmations.push(options.message);
      return { response: globalThis.fileActionTest.answer };
    };
    shell.trashItem = async file => {
      if (!file.startsWith(temp)) throw new Error("Test tried trashing outside its fixture directory");
      globalThis.fileActionTest.trash.push(file);
    };
  }, temp + path.sep);
  const wait = async (check, message) => {
    const end = Date.now() + 20_000;
    while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(message);
  };
  const state = () => app.evaluate(() => globalThis.fileActionTest);
  const queue = file => app.evaluate((_, file) => globalThis.fileActionTest.queue.push(file), file);
  const menuState = () => app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu().items.find(item => item.label === "File").submenu;
    return Object.fromEntries(menu.items.filter(item => item.label).map(item => [item.label, item.enabled]));
  });
  const native = async label => {
    await wait(async () => (await menuState())[label], `Native File/${label} never became enabled`);
    await app.evaluate(({ Menu, BrowserWindow }, label) => {
      const item = Menu.getApplicationMenu().items.find(item => item.label === "File").submenu.items.find(item => item.label === label);
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    }, label);
  };
  const open = async file => app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  const imageReady = async name => {
    await page.getByRole("button", { name: `View ${name}`, exact: true }).waitFor();
    await page.waitForFunction(name => document.querySelector(`[aria-label="View ${name}"]`)?.getAttribute("aria-current") === "true" && !document.querySelector('.photo-status') && !!document.querySelector('.page canvas'), name);
  };
  const outputReady = file => wait(() => existsSync(file), `Output missing: ${file}`);
  let drawIndex = 0;
  const draw = async () => {
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const layer = page.locator('.page[data-page-number="1"] .annotationEditorLayer.inkEditing'); await layer.waitFor();
    const box = await layer.boundingBox();
    const y = 40 + 100 * drawIndex++;
    await page.mouse.move(box.x + 40, box.y + y); await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + y + 60, { steps: 8 }); await page.mouse.up();
    await page.getByRole("button", { name: "Done", exact: true }).click();
  };
  assert.equal((await menuState()).Save, false, "Save enabled without a document");
  assert.equal((await menuState())["Reduce File Size…"], false);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, pdfPath);
  await native("Open…"); await page.locator('.page canvas').waitFor();
  await wait(async () => (await menuState())["Reduce File Size…"], "PDF compress disabled");
  await native("Properties…");
  await page.getByRole("dialog", { name: "Document info" }).waitFor();
  await page.keyboard.press("Escape");
  await native("Print…");
  await page.getByRole("dialog", { name: "Print", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await draw(); await queue(savedPdf); await native("Save"); await outputReady(savedPdf);
  await wait(async () => (await state()).dialogs.length === 1 && (await menuState()).Save, "First PDF save did not finish");
  const first = readFileSync(savedPdf);
  assert.ok((await PDFDocument.load(first)).getPage(0).node.Annots()?.size(), "PDF Save lost the drawing");
  await draw(); await native("Save");
  await wait(() => !readFileSync(savedPdf).equals(first), "Second Save did not update its existing target");
  assert.equal((await state()).dialogs.length, 1, "Second Save opened another dialog");
  await draw(); await queue(null); await native("Save As…");
  await wait(async () => (await state()).dialogs.length === 2 && (await menuState()).Save, "Cancelled Save As did not finish");
  const beforeCancelSave = readFileSync(savedPdf);
  await native("Save");
  await wait(() => !readFileSync(savedPdf).equals(beforeCancelSave), "Save As cancellation lost pending PDF edits");
  assert.equal((await state()).dialogs.length, 2, "Cancelled Save As discarded the previous Save target");
  const kept = await PDFDocument.load(readFileSync(savedPdf));
  const strokes = kept.getPage(0).node.Annots().asArray().reduce((count, ref) => count + (kept.context.lookup(ref).get(PDFName.of("InkList"))?.size() || 0), 0);
  assert.equal(strokes, 3, "Cancelled Save As lost one of the three drawn strokes");
  assert.deepEqual(readFileSync(pdfPath), Buffer.from(originalPdf), "PDF original was modified");
  console.log("ok native PDF Save chooses once then reuses target; cancelled Save As preserves pending marks");

  await native("Export / Convert…");
  const exportDialog = page.getByRole("dialog", { name: "Export a copy", exact: true }); await exportDialog.waitFor();
  await exportDialog.getByRole("button", { name: "Prepare export", exact: true }).click();
  await exportDialog.getByRole("button", { name: "Save copy…", exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, "file-export-dialog.png") });
  await queue(null); await exportDialog.getByRole("button", { name: "Save copy…", exact: true }).click();
  await wait(async () => (await state()).dialogs.length === 3, "Export Save dialog not reached");
  await exportDialog.getByRole("button", { name: "Save copy…", exact: true }).waitFor();
  await exportDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await native("Reduce File Size…");
  const compress = page.getByRole("dialog", { name: "Compress a copy", exact: true }); await compress.waitFor();
  await compress.getByRole("button", { name: "Compress", exact: true }).click();
  await compress.getByRole("button", { name: "Save copy…", exact: true }).waitFor();
  const compressed = path.join(temp, "compressed.pdf"); await queue(compressed);
  await compress.getByRole("button", { name: "Save copy…", exact: true }).click(); await outputReady(compressed);
  assert.equal((await PDFDocument.load(readFileSync(compressed))).getPageCount(), 1);
  console.log("ok native PDF Export retains prepared output after cancellation; Compress saves a separate PDF");

  const sourceImages = await page.evaluate(() => ["#e03020", "#2040e0"].map(color => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 200, height: 150 });
    const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, 200, 150); return canvas.toDataURL().split(",")[1];
  }));
  sourceImages.forEach((png, i) => writeFileSync(path.join(photos, `photo${i + 1}.png`), Buffer.from(png, "base64")));
  for (let i = 3; i <= 20; i++) writeFileSync(path.join(photos, `photo${i}.png`), Buffer.from(sourceImages[0], "base64"));
  await open(path.join(photos, "photo1.png")); await imageReady("photo1.png");
  // Native minimum height is 480; allow a shorter hidden viewport to exercise menu overflow.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(320, 240));
  const originalViewport = await page.window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const [width, height, name, keyboard] of [[1100, 800, "photo1.png", false], [1100, 800, "photo20.png", false], [420, 280, "photo20.png", true]]) {
    await page.window.setViewportSize({ width, height });
    const thumbnail = page.getByRole("button", { name: `View ${name}`, exact: true });
    await thumbnail.scrollIntoViewIfNeeded();
    if (keyboard) { await thumbnail.focus(); await page.keyboard.press("Shift+F10"); }
    else await thumbnail.click({ button: "right" });
    const menu = page.getByRole("menu", { name: `Actions for ${name}`, exact: true });
    await menu.waitFor();
    const geometry = await page.evaluate(name => {
      const anchor = document.querySelector(`[data-file="${name}"]`).getBoundingClientRect();
      const popup = document.querySelector('.file-context-menu');
      const box = popup.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, anchorTop: anchor.top, width: innerWidth, height: innerHeight, menuHeight: popup.clientHeight, contentHeight: popup.scrollHeight, scrollable: popup.scrollHeight > popup.clientHeight };
    }, name);
    assert.ok(geometry.bottom <= geometry.anchorTop - 7 && geometry.top >= 7, JSON.stringify(geometry));
    assert.ok(geometry.left >= 7 && geometry.right <= geometry.width - 7, JSON.stringify(geometry));
    if (keyboard) {
      assert.equal(geometry.scrollable, true, `Short viewport geometry: ${JSON.stringify(geometry)}`);
      await page.keyboard.press("End");
      await menu.getByRole("menuitem", { name: "Move to Trash…" }).waitFor();
      assert.equal(await menu.isVisible(), true, "Internal menu scrolling must not dismiss it");
      await page.screenshot({ path: path.join(shots, "carousel-menu-narrow.png") });
      await page.keyboard.press("Escape");
    } else {
      await page.screenshot({ path: path.join(shots, `carousel-menu-${name === "photo1.png" ? "left" : "right"}.png`) });
      await page.keyboard.press("Escape");
    }
    await menu.waitFor({ state: "detached" });
  }
  await page.window.setViewportSize(originalViewport);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(420, 480));
  console.log("ok carousel menu stays above its thumbnail at both edges and scrolls in a short window; mouse and keyboard agree");
  assert.equal((await menuState())["Reduce File Size…"], true);
  drawIndex = 0; await draw();
  const beforePhotoCancel = (await state()).dialogs.length;
  await queue(null); await native("Save As…");
  await wait(async () => (await state()).dialogs.length === beforePhotoCancel + 1 && (await menuState()).Save, "Photo Save As cancellation did not finish");
  await page.window.evaluate(() => { window.fileCloseQuestions = []; window.confirm = message => { window.fileCloseQuestions.push(message); return false; }; });
  await native("Close Tab");
  await page.window.waitForFunction(() => window.fileCloseQuestions.length === 1);
  assert.match(await page.window.evaluate(() => window.fileCloseQuestions[0]), /unsaved|discard/i);
  const cleanPhoto = path.join(temp, "photo1-edited.png"); await queue(cleanPhoto); await native("Save"); await outputReady(cleanPhoto);
  await wait(async () => (await menuState()).Save, "Photo save did not finish");
  const savedPhoto = path.join(temp, "photo2-copy.png"); await queue(savedPhoto);
  await page.getByRole("button", { name: "View photo2.png", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Save As…", exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, "file-photo-context-menu.png") });
  await page.getByRole("menuitem", { name: "Save As…", exact: true }).click(); await outputReady(savedPhoto); await imageReady("photo2.png");
  const corner = await page.evaluate(async data => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(data)], { type: "image/png" }));
    const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); image.close(); return [...context.getImageData(10, 10, 1, 1).data];
  }, [...readFileSync(savedPhoto)]);
  assert.deepEqual(corner, [32, 64, 224, 255], "Thumbnail Save As exported the previously selected photo");
  await page.getByRole("button", { name: "View photo1.png", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Print…", exact: true }).click();
  const photoPrint = page.getByRole("dialog", { name: "Print", exact: true });
  await photoPrint.waitFor();
  assert.match(await photoPrint.locator('.print-filename').innerText(), /photo1/);
  await page.keyboard.press("Escape");
  await imageReady("photo1.png");
  const trashName = "photo2.png";
  const trash = async answer => {
    await app.evaluate((_, answer) => { globalThis.fileActionTest.answer = answer; }, answer);
    await page.getByRole("button", { name: `View ${trashName}`, exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to Trash…", exact: true }).click();
  };
  await trash(0); await wait(async () => (await state()).confirmations.length === 1, "Trash cancel confirmation missing");
  assert.deepEqual((await state()).trash, []);
  await trash(1); await wait(async () => (await state()).trash.length === 1, "Trash confirm did not reach shell");
  assert.deepEqual((await state()).trash, [path.join(photos, trashName)]);
  sourceImages.forEach((png, i) => assert.deepEqual(readFileSync(path.join(photos, `photo${i + 1}.png`)), Buffer.from(png, "base64"), "Photo original changed"));
  console.log("ok unselected thumbnail Save As exports the correct photo; Trash cancellation/confirmation stays inside mock");

  await open(markdown); await page.getByRole("heading", { name: "File menu notes", exact: true }).waitFor();
  await wait(async () => (await menuState()).Save, "Markdown menu never activated");
  assert.equal((await menuState())["Reduce File Size…"], false, "Markdown compression must be disabled");
  const text = path.join(temp, "notes.txt"), html = path.join(temp, "notes.html");
  for (const [file, label] of [[text, "Save text…"], [html, "Save HTML…"]]) {
    await queue(file); await native("Export / Convert…");
    await page.getByRole("dialog", { name: "Export Markdown", exact: true }).getByRole("button", { name: label, exact: true }).click();
    await outputReady(file);
  }
  assert.equal(readFileSync(text, "utf8"), readFileSync(markdown, "utf8"));
  assert.match(readFileSync(html, "utf8"), /<strong>bold<\/strong>/);
  assert.ok((readFileSync(html, "utf8").match(/<math/g) || []).length >= 2, "Export HTML lost inline or display math");
  await page.evaluate(() => { window.fileTestPrinted = []; window.print = () => window.fileTestPrinted.push(document.querySelector('.markdown-print')?.innerHTML || ""); });
  await native("Print…"); await page.waitForFunction(() => window.fileTestPrinted.length === 1);
  assert.match(await page.evaluate(() => window.fileTestPrinted[0]), /<strong>bold<\/strong>/);
  assert.ok((await page.evaluate(() => window.fileTestPrinted[0]).then(markup => markup.match(/<math/g) || [])).length >= 2, "Print lost inline or display math");
  assert.equal(readFileSync(markdown, "utf8"), "# File menu notes\n\nA **bold** paragraph with $x^2$.\n\n$$\ny=2x\n$$\n");
  assert.deepEqual((await state()).queue, [], "A scheduled Save dialog was never reached");
  await assertHidden(app); assert.deepEqual(errors, []);
  console.log(`PASS native File actions (${process.platform}): PDF Save/Save As, dirty cancellation, Export/Compress, thumbnail Save As, mocked Trash, Markdown HTML/TXT/Print and kind-specific menu state`);
} catch (error) {
  console.error("File action diagnostics:", await app.evaluate(() => globalThis.fileActionTest));
  console.error("Reader:", await readerPage(await app.firstWindow()).locator("body").innerText().catch(() => "unavailable"));
  throw error;
} finally { await app.close(); rmSync(temp, { recursive: true, force: true }); }
