// Real desktop content flows, with an isolated profile and no visible window. Run after npm run build.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden } from "./hidden-window.mjs";

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
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "gallery overflows the window");
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
  // This isolated harness must also exit after an assertion leaves unsaved notes open.
  await app.evaluate(({ BrowserWindow }) => {
    if (process.env.FOLIO_TEST_USER_DATA && process.env.FOLIO_TEST_HIDDEN === "1") {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    }
  }).catch(() => {});
  await app.close();
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
