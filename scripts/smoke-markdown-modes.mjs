// Real Markdown mode, editing and section-navigation checks. Run after npm run build.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-markdown-modes-"));
const shots = path.join(root, "release", "smoke");
mkdirSync(shots, { recursive: true });
const file = path.join(temp, "Sections.md");
const plain = path.join(temp, "Plain.md");
const math = path.join(temp, "Math.md");
const paragraph = "A section paragraph for scrolling and navigation. ".repeat(12);
const document = ["# Opening", "", "**Bold** and [a link](https://example.com).", "", "```python", "def greet(name):", '    return "Hello " + name', "# Not a section", "```", "", ...Array.from({ length: 8 }, (_, i) => `${i % 2 ? "###" : "##"} Repeated section\n\n${Array(5).fill(paragraph).join("\n\n")}\n`), "Setext ending", "============", "", "The final section.", ""].join("\n");
writeFileSync(file, document);
writeFileSync(plain, "A document without headings.\n");
writeFileSync(math, "\\[\n# x+y\n\\]\n\n# Actual section\n");
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const page = readerPage(await app.firstWindow());
  const errors = [];
  page.on("pageerror", error => errors.push(error.stack ?? String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const preview = () => page.getByLabel("Markdown preview", { exact: true });
  const editor = () => page.getByRole("textbox", { name: "Markdown source", exact: true });
  const navigation = () => page.getByRole("navigation", { name: "Document sections", exact: true });
  const open = async file => {
    await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
    await preview().waitFor();
  };
  const source = async () => {
    await page.getByRole("button", { name: "View source", exact: true }).click();
    await editor().waitFor();
    assert.equal(await preview().isVisible(), false);
  };
  const view = async () => {
    await page.getByRole("button", { name: "View", exact: true }).click();
    await preview().waitFor();
    assert.equal(await editor().isVisible(), false);
  };
  const fullWidth = async locator => {
    const width = await locator.evaluate(element => element.getBoundingClientRect().width);
    const paneWidth = await page.locator(".markdown-pane").evaluate(element => element.getBoundingClientRect().width);
    assert.ok(width >= paneWidth - 100, `active Markdown pane occupies only ${width}/${paneWidth}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Markdown causes window overflow");
  };
  const activeSection = async index => {
    await page.waitForFunction(index => {
      const buttons = [...document.querySelectorAll('[aria-label="Document sections"] button')];
      return buttons[index]?.getAttribute("aria-current") === "location";
    }, index);
    assert.equal(await navigation().locator('[aria-current="location"]').count(), 1);
  };
  const renderedSectionVisible = async index => {
    await page.waitForFunction(index => {
      const section = document.querySelector(`#md-section-${index}`)?.getBoundingClientRect();
      const viewport = document.querySelector(".markdown-rendered")?.getBoundingClientRect();
      return section && viewport && section.top >= viewport.top - 1 && section.top < viewport.bottom;
    }, index);
  };

  await open(file);
  await preview().getByRole("heading", { name: "Opening", exact: true }).waitFor();
  assert.equal(await editor().isVisible(), false, "Markdown did not default to read-only View");
  assert.equal(await preview().evaluate(element => element.isContentEditable), false);
  assert.equal(await navigation().getByRole("button").count(), 10, "fenced code became a heading or setext heading disappeared");
  assert.equal(await navigation().getByRole("button", { name: "Repeated section", exact: true }).count(), 8);
  assert.equal(await navigation().getByRole("button", { name: "Not a section", exact: true }).count(), 0);
  await activeSection(0);
  await fullWidth(page.locator(".markdown-rendered"));
  await navigation().getByRole("button", { name: "Repeated section", exact: true }).nth(5).click();
  await activeSection(6);
  await renderedSectionVisible(6);
  await page.locator(".markdown-rendered").evaluate(element => { element.scrollTop = 0; });
  await activeSection(0);
  const end = navigation().getByRole("button", { name: "Setext ending", exact: true });
  await end.hover();
  await page.getByRole("tooltip", { name: "Setext ending", exact: true }).waitFor();
  await end.focus();
  await page.getByRole("tooltip", { name: "Setext ending", exact: true }).waitFor();
  await page.keyboard.press("Enter");
  await activeSection(9);
  await renderedSectionVisible(9);
  console.log("ok  default full-width read-only View, duplicate/level/setext headings, fenced-code exclusion and keyboard minimap navigation");

  await source();
  await fullWidth(page.locator(".markdown-source"));
  await navigation().getByRole("button", { name: "Opening", exact: true }).click();
  await activeSection(0);
  await page.waitForFunction(() => document.querySelector(".cm-scroller")?.scrollTop < 10);
  assert.ok(await page.locator(".cm-lineNumbers .cm-gutterElement").count() > 1, "source has no line numbers");
  assert.ok(await editor().locator(".cm-line span[class]").count() > 0, "source has no highlighted tokens");
  const pythonToken = editor().locator(".cm-line").filter({ hasText: "def greet(name):" }).locator("span").filter({ hasText: /^def$/ });
  assert.equal(await pythonToken.count(), 1, "Python fenced code has no highlighted keyword");
  const keywordColor = await pythonToken.evaluate(element => getComputedStyle(element).color);
  assert.notEqual(keywordColor, await editor().evaluate(element => getComputedStyle(element).color), "Python keyword uses plain source color");
  await end.click();
  await activeSection(9);
  await page.waitForFunction(() => {
    const scroll = document.querySelector(".cm-scroller");
    return scroll && scroll.scrollTop > 0;
  });
  assert.ok((await editor().innerText()).includes("Setext ending"), "source navigation did not reveal the final heading");
  await page.locator(".cm-scroller").evaluate(element => { element.scrollTop = 0; });
  await activeSection(0);

  await editor().focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("## Added during editing");
  await view();
  await preview().getByRole("heading", { name: "Added during editing", exact: true }).waitFor();
  assert.equal(await navigation().getByRole("button").count(), 11);
  await source();
  await editor().focus();
  await page.keyboard.press("ControlOrMeta+z");
  await view();
  assert.equal(await preview().getByRole("heading", { name: "Added during editing", exact: true }).count(), 0, "View toggle lost source undo history");
  await source();
  await editor().focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
  await view();
  await preview().getByRole("heading", { name: "Added during editing", exact: true }).waitFor();
  await source();
  await editor().focus();
  await page.keyboard.press("ControlOrMeta+s");
  const saved = document + "\n## Added during editing";
  try { await eventually(() => readFileSync(file, "utf8") === saved, "source edit was not saved byte-for-byte"); }
  catch (error) { const actual = readFileSync(file, "utf8"); console.error({ actualLength: actual.length, expectedLength: saved.length, actualTail: actual.slice(-130), expectedTail: saved.slice(-130), firstDifference: [...saved].findIndex((character, index) => character !== actual[index]) }); throw error; }
  console.log("ok  full-width source, line numbers, Python syntax highlighting, minimap scrolling and undo/redo across mode changes");

  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await page.window.setViewportSize({ width, height });
    for (const theme of ["dark", "light"]) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
        await page.getByRole("button", { name: theme === "dark" ? "Use dark theme" : "Use light theme", exact: true }).click();
      }
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await fullWidth(page.locator(".markdown-source"));
      assert.ok(await navigation().isVisible());
      await navigation().getByRole("button", { name: "Opening", exact: true }).click();
      await activeSection(0);
      await page.screenshot({ path: path.join(shots, `markdown-source-${width}-${theme}.png`) });
      await view();
      await fullWidth(page.locator(".markdown-rendered"));
      assert.ok(await navigation().isVisible());
      await navigation().getByRole("button", { name: "Opening", exact: true }).click();
      await activeSection(0);
      await page.screenshot({ path: path.join(shots, `markdown-view-${width}-${theme}.png`) });
      await source();
    }
  }
  await page.getByRole("tablist", { name: "Open documents" }).getByRole("button", { name: "Close Sections.md", exact: true }).click();
  await open(file);
  await preview().getByRole("heading", { name: "Added during editing", exact: true }).waitFor();
  await open(math);
  await preview().getByRole("heading", { name: "Actual section", exact: true }).waitFor();
  assert.equal(await navigation().getByRole("button").count(), 1, "escaped math created a phantom section");
  await navigation().getByRole("button", { name: "Actual section", exact: true }).click();
  assert.equal(await preview().getByRole("heading", { name: "Actual section", exact: true }).getAttribute("id"), "md-section-0");
  await source();
  await navigation().getByRole("button", { name: "Actual section", exact: true }).click();
  await editor().focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "# Actual section", "escaped math shifted the source section destination");
  await open(plain);
  await preview().getByText("A document without headings.", { exact: true }).waitFor();
  assert.equal(await navigation().isVisible(), false, "headless document shows an empty minimap");
  await source();
  assert.equal(await navigation().isVisible(), false);
  await fullWidth(page.locator(".markdown-source"));
  await assertHidden(app);
  assert.deepEqual(errors, []);
  console.log(`PASS Markdown modes (${process.platform}): narrow/wide light/dark layouts, saved reload, headingless document and hidden window`);
} catch (error) {
  await app.windows()[0]?.screenshot({ path: path.join(shots, "markdown-modes-failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.close();
  rmSync(temp, { recursive: true, force: true });
}

async function eventually(check, message) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message);
}
