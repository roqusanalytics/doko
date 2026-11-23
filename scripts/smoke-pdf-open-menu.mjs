// Run against the built app. Set FOLIO_OPEN_MENU_SHOTS to capture the Welcome and menu views.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-pdf-open-menu-"));
const shots = process.env.FOLIO_OPEN_MENU_SHOTS;
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };

delete env.ELECTRON_RUN_AS_NODE;

const mac = process.platform === "darwin";

/** @type {[string, string[]][]} */
const formats = [
  ["PDF", ["pdf"]],
  ["Markdown", ["md", "markdown"]],
  ["Photos", ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]],
  ["Excel", ["xlsx", "xls"]],
  ["Word", ["doc", "docx"]],
];

let app;

try {
  app = await electron.launch({ executablePath: electronPath(env), args: [root, "--mute-audio",
    ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], env });
  const window = await app.firstWindow();
  window.setDefaultTimeout(15_000);
  const page = readerPage(window);
  const sample = page.getByRole("button", { name: "Try a sample document" });
  const trigger = page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Open", exact: true });
  const menu = page.getByRole("menu", { name: "Open", exact: true });
  const item = name => menu.getByRole("menuitem", { name, exact: true });
  const pdfTab = page.getByRole("tab", { name: "Doko sample.pdf", exact: true });

  const openMenu = async (key = "Enter") => {
    await trigger.press(key);
    await menu.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('[role="menuitem"]'));
  };

  const focused = locator => locator.evaluate(element => element === document.activeElement);

  const checkEscape = async () => {
    await window.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert.ok(await focused(trigger), "Escape returns focus to Open");
  };

  const openSettings = async () => {
    await page.keyboard.press(mac ? "Meta+Comma" : "Control+Comma");
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.waitFor();

    return settings;
  };

  const closeSettings = async settings => {
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "hidden" });
    await window.mouse.move(4, 4);
  };

  const chooseTheme = async theme => {
    const settings = await openSettings();
    await settings.getByRole("radio", { name: theme, exact: true }).click();

    if (theme === "Light") {
      await settings.getByRole("button", { name: "Paper background", exact: true }).click();
      const workArea = page.getByRole("textbox", { name: "Work area", exact: true });
      await settings.locator(".appearance-color", { has: workArea }).getByRole("button", { name: "Auto", exact: true }).click();
    }

    await closeSettings(settings);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme.toLowerCase());
  };

  await sample.waitFor();
  await assertHidden(app);

  if (shots) {
    mkdirSync(shots, { recursive: true });
    await window.setViewportSize({ width: 1280, height: 800 });
    await chooseTheme("Light");
    await window.screenshot({ path: path.join(shots, "welcome-canvas.png") });
  }

  await sample.click();
  await page.locator(".page canvas").first().waitFor();
  assert.equal(await trigger.evaluate(button => button.parentElement.previousElementSibling.getAttribute("aria-label")), "Edit mode");
  await openMenu();
  const labels = ["New canvas", ...formats.map(([name]) => name), "From URL…"];
  assert.equal(await menu.getByRole("menuitem").count(), labels.length);
  assert.equal(await menu.getByRole("separator").count(), 2);
  assert.ok(await focused(item("New canvas")));

  for (const name of labels.slice(1)) {
    await window.keyboard.press("ArrowDown");
    assert.ok(await focused(item(name)), `${name} has focus and an accessible name`);
  }

  assert.equal(await item("New canvas").locator("kbd").textContent(), mac ? "⇧⌘N" : "Ctrl+Shift+N");
  await window.keyboard.press("ArrowUp");
  assert.ok(await focused(item("Word")));

  if (shots) {
    await window.keyboard.press("Home");
    await window.screenshot({ path: path.join(shots, "pdf-open-menu-light.png") });
    await checkEscape();
    await chooseTheme("Dark");
    await openMenu();
    await window.screenshot({ path: path.join(shots, "pdf-open-menu-dark.png") });
  }

  await checkEscape();
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");

  const settings = await openSettings();
  await settings.getByRole("button", { name: "Custom background", exact: true }).click();
  await settings.getByRole("textbox", { name: "Custom color", exact: true }).fill("#dceaf0");
  await settings.getByRole("switch", { name: "Window transparency", exact: true }).click();
  await closeSettings(settings);
  await page.waitForFunction(() => document.documentElement.dataset.appearance === "#dceaf0"
    && document.documentElement.hasAttribute("data-window-transparency"));
  await openMenu();
  assert.ok(await focused(item("New canvas")));

  const appearance = await menu.evaluate(panel => {
    const { color, backgroundColor, borderRadius } = getComputedStyle(panel);

    return { color, backgroundColor, borderRadius };
  });

  assert.equal(appearance.color, "rgb(0, 0, 0)");
  assert.equal(appearance.borderRadius, "12px");
  assert.notEqual(appearance.backgroundColor, "rgba(0, 0, 0, 0)");
  await checkEscape();

  for (const width of [1100, 600, 420]) {
    await window.setViewportSize({ width, height: 720 });
    assert.ok(await page.locator(".topbar button:visible").evaluateAll(buttons => buttons.every(button => {
      const { x, y, width, height } = button.getBoundingClientRect();

      return button.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    })), `Toolbar controls stay clickable at ${width}px`);
    await openMenu("Space");
    assert.ok(await focused(item("New canvas")));
    assert.ok(await trigger.evaluate(button => {
      const bounds = button.getBoundingClientRect();

      return bounds.left >= 0 && bounds.right <= innerWidth && getComputedStyle(button.querySelector("span")).display === "none";
    }), `Open stays reachable with compact controls at ${width}px`);
    assert.ok(await menu.evaluate(panel => {
      const bounds = panel.getBoundingClientRect();

      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
    }), `Menu stays in view at ${width}px`);
    await checkEscape();
  }

  console.log("PASS named menu items and shortcut, Enter/Space, arrow navigation, Escape focus, custom background with transparency enabled, and narrow layout");

  await openMenu();
  await window.keyboard.press("Enter");
  await page.getByRole("tab", { name: "Untitled Canvas", exact: true, selected: true }).waitFor();
  await page.locator(".excalidraw").waitFor();
  await pdfTab.waitFor();
  await pdfTab.click();

  await openMenu();
  await item("From URL…").click();
  const urlDialog = page.getByRole("dialog", { name: "Open from URL", exact: true });
  await urlDialog.waitFor();
  assert.ok(await urlDialog.getByRole("button", { name: "Open", exact: true }).isDisabled());
  await urlDialog.getByRole("button", { name: "Cancel" }).click();

  const markdown = path.join(temp, "Opened from menu.md");
  writeFileSync(markdown, "# Opened from the PDF toolbar\n");
  await app.evaluate(({ dialog }, file) => {
    globalThis.openMenuCalls = [];
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.openMenuCalls.push(options);

      return options.filters[0].name === "Markdown"
        ? { canceled: false, filePaths: [file] }
        : { canceled: true, filePaths: [] };
    };
  }, markdown);

  const allExtensions = ["pdf", "doc", "docx", "xlsx", "xls", "md", "markdown", "txt", "csv", "svg", "html", "htm",
    "excalidraw", "jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];

  for (const [index, [name, extensions]] of formats.entries()) {
    await openMenu();
    await item(name).click();
    const deadline = Date.now() + 5_000;
    let calls = await app.evaluate(() => globalThis.openMenuCalls);

    while (calls.length <= index && Date.now() < deadline) {
      await delay(25);
      calls = await app.evaluate(() => globalThis.openMenuCalls);
    }

    assert.equal(calls.length, index + 1, `${name} opens one native dialog`);
    assert.deepEqual(calls[index].filters, [{ name, extensions }, { name: "All supported files", extensions: allExtensions }]);

    if (name === "Markdown") {
      await page.getByRole("heading", { name: "Opened from the PDF toolbar" }).waitFor();
      await page.getByRole("tab", { name: "Opened from menu.md", exact: true, selected: true }).waitFor();
      await pdfTab.click();
    }
  }

  await assertHidden(app);
  console.log("PASS Canvas and native Markdown open in their own tabs, URL opens the existing dialog, and all five native filters match Welcome");
} finally {
  try {
    if (app) await closeHidden(app);
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
