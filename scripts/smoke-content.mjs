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
  await editor().waitFor();
  assert.equal(await editor().inputValue(), original);
  assert.equal(await page.locator(".content-toolbar").evaluate(element => getComputedStyle(element).display), "flex", "reader styles were not loaded");
  assert.ok((await editor().boundingBox()).width > 300, "desktop Markdown editor collapsed");
  await preview().getByRole("heading", { name: "Field notes", exact: true }).waitFor();
  const edited = "# Revised field notes\n\nSaved **bold** and $x^2$.\n";
  await editor().fill(edited);
  await preview().getByRole("heading", { name: "Revised field notes", exact: true }).waitFor();
  await save();
  await diskIs(first, "\ufeff" + edited.replaceAll("\n", "\r\n"));
  await page.screenshot({ path: path.join(shots, "content-markdown.png") });
  console.log("ok  native Markdown open, preview and keyboard save preserve UTF-8 BOM and CRLF");

  await editor().fill("# Unsaved local edit\n");
  await open(first);
  assert.equal(await editor().inputValue(), "# Unsaved local edit\n", "reopening the same file lost edits");
  assert.equal(await page.window.locator("iframe.document-reader").count(), 1, "same path created a duplicate tab");
  // Identical bytes in two paths must remain independent documents.
  writeFileSync(second, readFileSync(first));
  await open(second);
  await editor().waitFor();
  await docs.getByRole("tab", { name: /Other.markdown/, selected: true }).waitFor();
  assert.equal(await page.window.locator("iframe.document-reader").count(), 2);
  assert.equal(await editor().inputValue(), edited);
  await docs.getByRole("tab", { name: /Notes.md/ }).click();
  assert.equal(await editor().inputValue(), "# Unsaved local edit\n");

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
  assert.equal(await editor().inputValue(), "# Unsaved local edit\n");
  await unsavedClose.click();
  await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await docs.getByRole("tab", { name: /Notes.md/ }).waitFor({ state: "detached" });
  await open(first);
  await editor().waitFor();
  assert.equal(await editor().inputValue(), edited);
  await editor().fill("# Save on close\n");
  await docs.getByRole("button", { name: /Close Notes.md/ }).click();
  await confirmation.getByRole("button", { name: "Save", exact: true }).click();
  await diskIs(first, "\ufeff# Save on close\r\n");
  await docs.getByRole("tab", { name: /Notes.md/ }).waitFor({ state: "detached" });
  await open(first);
  await editor().waitFor();
  assert.equal(await editor().inputValue(), "# Save on close\n");
  console.log("ok  file identity, independent identical files, close Cancel/Discard/Save and reopen");

  await editor().fill("# Local changes\n");
  writeFileSync(first, "\ufeff# Changed outside Folio\r\n");
  await save();
  await page.getByRole("button", { name: "Reload from disk", exact: true }).waitFor();
  assert.equal(readFileSync(first, "utf8"), "\ufeff# Changed outside Folio\r\n", "conflict overwrote external edits");
  assert.equal(await editor().inputValue(), "# Local changes\n");
  await page.getByRole("button", { name: "Reload from disk", exact: true }).click();
  const reload = page.getByRole("dialog", { name: "Reload from disk", exact: true });
  await reload.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await editor().inputValue(), "# Local changes\n");
  await page.getByRole("button", { name: "Reload from disk", exact: true }).click();
  await reload.getByRole("button", { name: "Discard and reload", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Markdown source"]').value === "# Changed outside Folio\n");
  await editor().fill("");
  await save();
  await diskIs(first, "\ufeff");
  const untrusted = '# Safe title\n\n<script>window.contentExecuted = true</script>\n\n<img src="https://example.invalid/trap.png" onerror="window.contentExecuted = true">\n';
  await editor().fill(untrusted);
  await preview().getByRole("heading", { name: "Safe title" }).waitFor();
  assert.equal(await page.evaluate(() => Boolean(window.contentExecuted)), false);
  assert.equal(await preview().locator("script, img[src^='http']").count(), 0);
  await editor().fill("# Long text\n\n" + "A paragraph of notes. ".repeat(10_000));
  await save();
  await diskIs(first, "\ufeff" + (await editor().inputValue()).replaceAll("\n", "\r\n"));
  console.log("ok  conflicts preserve both versions, explicit reload, empty/long text and inert HTML");
  await app.evaluate(({ dialog }) => {
    globalThis.contentOpenErrors = [];
    dialog.showErrorBox = (title, detail) => globalThis.contentOpenErrors.push({ title, detail });
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
  });
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  assert.equal(await editor().inputValue(), "# Long text\n\n" + "A paragraph of notes. ".repeat(10_000));
  for (const [name, bytes] of [["invalid.md", Buffer.from([0xff, 0xfe, 0x61])], ["oversized.md", Buffer.alloc(5 * 1024 * 1024 + 1, 65)]]) {
    const file = path.join(temp, name);
    writeFileSync(file, bytes);
    const count = await app.evaluate(() => globalThis.contentOpenErrors.length);
    await open(file, false);
    await assertEventually(async () => (await app.evaluate(() => globalThis.contentOpenErrors.length)) > count, "invalid Markdown did not report an error");
    assert.equal(await editor().inputValue(), "# Long text\n\n" + "A paragraph of notes. ".repeat(10_000));
  }
  console.log("ok  cancelled Save copy and invalid/oversized Markdown leave the current document intact");

  const png = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(800 * 600 * 4, 190), { width: 800, height: 600 }).toPNG().toString("base64"));
  for (let i = 1; i <= 20; i++) writeFileSync(path.join(photos, `image${i}.png`), Buffer.from(png, "base64"));
  mkdirSync(path.join(photos, "Nested"));
  writeFileSync(path.join(photos, "Nested", "nested.png"), Buffer.from(png, "base64"));
  try { symlinkSync(path.join(photos, "image1.png"), path.join(photos, "linked.png")); }
  catch (error) { if (process.platform !== "win32" || error.code !== "EPERM") throw error; }
  await open(path.join(photos, "image10.png"));
  const gallery = page.getByLabel("Image gallery", { exact: true });
  const position = page.getByLabel("Image position", { exact: true });
  const at = async number => page.waitForFunction(number => document.querySelector('[aria-label="Image position"]').textContent.replace(/\s/g, "") === `${number}/20`, number);
  await gallery.waitFor();
  assert.ok(await gallery.evaluate(element => element.clientHeight < element.scrollHeight), "gallery must scroll within the window");
  await at(10);
  await gallery.getByRole("img", { name: "image10.png", exact: true }).waitFor();
  assert.ok(await gallery.evaluate(element => {
    const image = element.querySelector('img[alt="image10.png"]')?.getBoundingClientRect();
    const viewport = element.getBoundingClientRect();
    return image && image.top >= viewport.top && image.bottom <= viewport.bottom;
  }), "initially selected image is outside the gallery viewport");
  await page.getByRole("button", { name: "100%", exact: true }).click();
  const pixels = await gallery.getByRole("img", { name: "image10.png", exact: true }).evaluate(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }));
  assert.equal(pixels.width, pixels.naturalWidth, "100% image width is not intrinsic pixels");
  assert.equal(pixels.height, pixels.naturalHeight, "100% image height is not intrinsic pixels");
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await at(11);
  await page.getByRole("button", { name: "Previous image", exact: true }).click();
  await at(10);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  assert.deepEqual(await gallery.locator("figure").evaluateAll(cards => cards.map(card => card.dataset.file)), Array.from({ length: 20 }, (_, i) => `image${i + 1}.png`));
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await at(11);
  await gallery.focus();
  await page.keyboard.press("ArrowLeft");
  await at(10);
  await open(path.join(photos, "image2.png"));
  await at(2);
  assert.equal(await page.window.locator("iframe.document-reader").count(), 3, "same folder created a second gallery");
  await page.getByRole("button", { name: "Previous image", exact: true }).click();
  await at(1);
  assert.ok(await page.getByRole("button", { name: "Previous image", exact: true }).isDisabled());
  await gallery.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await at(20);
  assert.ok(await page.getByRole("button", { name: "Next image", exact: true }).isDisabled());
  await assertEventually(async () => !(await gallery.getByRole("img", { name: "image1.png", exact: true }).count()), "distant gallery image stayed loaded");
  console.log("ok  20-image natural order, selected middle, sibling dedup, arrows, scroll edges and unload");

  writeFileSync(path.join(photos, "image21.png"), "corrupt image");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Image position"]').textContent.replace(/\s/g, "") === "20/21");
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  const broken = gallery.locator('figure[data-file="image21.png"]');
  await broken.getByRole("button", { name: "Retry", exact: true }).waitFor();
  writeFileSync(path.join(photos, "image21.png"), Buffer.from(png, "base64"));
  await broken.getByRole("button", { name: "Retry", exact: true }).click();
  await broken.getByRole("img", { name: "image21.png", exact: true }).waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('figure[data-file="image21.png"] img'); return image?.complete && image.naturalWidth > 0; });
  await page.screenshot({ path: path.join(shots, "content-gallery.png") });
  console.log("ok  refresh preserves selected image; corrupt image can be repaired and retried");
  const varied = path.join(temp, "Formats");
  mkdirSync(varied);
  const fixtures = JSON.parse(readFileSync(path.join(root, "scripts", "fixtures", "content-images.json"), "utf8"));
  fixtures.jpg = fixtures.jpeg;
  fixtures.png = png;
  for (const [extension, data] of Object.entries(fixtures)) writeFileSync(path.join(varied, `photo.${extension}`), Buffer.from(data, "base64"));
  for (const extension of Object.keys(fixtures)) {
    const name = `photo.${extension}`;
    await open(path.join(varied, name));
    await page.waitForFunction(name => {
      const image = [...document.querySelectorAll('img')].find(image => image.alt === name);
      return image?.complete && image.naturalWidth > 0;
    }, name);
  }
  await page.screenshot({ path: path.join(shots, "content-image-formats.png") });
  await close("Formats");
  await docs.getByRole("tab", { name: "Photos", exact: true }).click();
  console.log("ok  actual JPEG/JPG/PNG/WEBP/GIF/BMP/AVIF files decode in the desktop gallery");

  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await page.window.setViewportSize({ width, height });
    for (const theme of ["dark", "light"]) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
        await page.getByRole("button", { name: theme === "dark" ? "Use dark theme" : "Use light theme", exact: true }).click();
      }
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
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await preview().getByRole("heading", { name: "Long text", exact: true }).waitFor();
  assert.equal(await editor().isVisible(), false);
  await page.screenshot({ path: path.join(shots, "content-markdown-mobile.png") });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor().waitFor();
  await close("Notes.md");
  await close("Other.markdown");
  await close("Photos");
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
  assert.match(await page.locator(".textLayer").first().innerText(), /A short tour of Folio/);
  await assertHidden(app);
  assert.deepEqual(errors, []);
  console.log(`PASS content (${process.platform}): responsive themes, PDF regression and hidden window`);
} catch (error) {
  const window = app.windows()[0];
  if (window) {
    await window.screenshot({ path: path.join(shots, "content-failure.png") }).catch(() => {});
    console.error(await readerPage(window).evaluate(() => ({ title: document.title,
      position: document.querySelector('[aria-label="Image position"]')?.textContent,
      scroll: [...document.querySelectorAll('[aria-label="Image gallery"]')].map(element => ({ top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight })) })).catch(() => null));
  }
  throw error;
} finally {
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
