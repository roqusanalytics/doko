// Run after npm run build. Drive both Canvas entries with a hidden, disposable Doko window.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-canvas-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio",
  ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const window = await app.firstWindow();
  window.setDefaultTimeout(10_000);
  const page = readerPage(window);
  const requests = [], pageErrors = [];
  window.on("request", request => requests.push(request.url()));
  window.on("pageerror", error => pageErrors.push(error.message));
  await window.addInitScript(() => {
    globalThis.canvasDocumentViolations = [];
    addEventListener("securitypolicyviolation", event => {
      globalThis.canvasDocumentViolations.push(event.effectiveDirective + ": " + event.blockedURI);
    });
  });
  const welcome = page.getByRole("button", { name: "New canvas", exact: true });
  await welcome.waitFor({ timeout: 30_000 });
  assert.ok(!requests.some(url => url.includes("CanvasReader-")), "Canvas code loaded on Welcome");

  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu().items.find(item => item.label === "File").submenu.items
      .find(item => item.label === "New Canvas");
    if (item?.accelerator !== "CmdOrCtrl+Shift+N") throw new Error("Missing native New Canvas shortcut");
    item.click(item, BrowserWindow.getAllWindows()[0], {});
  });
  const canvasDocumentEditor = page.locator(".excalidraw");
  const surface = page.locator("canvas.excalidraw__canvas.interactive");
  const sceneImage = () => page.locator("canvas.excalidraw__canvas.static").evaluate(element => element.toDataURL());
  await surface.waitFor();
  const firstTab = page.getByRole("tab", { name: "Untitled Canvas", exact: true });
  assert.equal(await firstTab.getAttribute("aria-selected"), "true");
  assert.equal(await firstTab.locator("svg").count(), 1, "Canvas tab icon missing");
  assert.ok(requests.some(url => url.includes("CanvasReader-")), "Canvas reader was not loaded lazily");

  for (const tool of ["selection", "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "eraser"]) {
    await page.locator(`[data-testid="toolbar-${tool}"]`).waitFor();
  }
  await page.getByRole("button", { name: "More tools", exact: true }).click();
  await page.getByText("Frame tool", { exact: true }).waitFor();
  await page.getByText("Laser pointer", { exact: true }).waitFor();
  await page.locator('[data-testid="main-menu-trigger"]').click();
  const menu = page.locator(".dropdown-menu").filter({ has: page.locator('[data-testid="search-menu-button"]') });
  for (const item of ["Find on canvas", "Help", "Reset the canvas", "Canvas background", "Library"]) {
    await menu.getByText(item, { exact: true }).waitFor();
  }
  assert.deepEqual(await menu.locator("button.dropdown-menu-item .dropdown-menu-item__text").allTextContents(),
    ["Find on canvas", "Help", "Reset the canvas", "Library"]);
  await menu.getByText("Library", { exact: true }).click();
  await page.getByText("No items added yet...", { exact: true }).waitFor();
  assert.equal(await page.locator(".library-menu-browse-button").filter({ visible: true }).count(), 0);
  await page.locator('[data-testid="sidebar-close"]').click();

  const before = await sceneImage();
  const bounds = await surface.boundingBox();
  assert.ok(bounds && bounds.width > 400 && bounds.height > 200, "Drawing surface did not fill the reader");
  const drawX = bounds.x + bounds.width * 0.45, drawY = bounds.y + bounds.height * 0.45;
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  await page.mouse.move(drawX, drawY);
  await page.mouse.down();
  await page.mouse.move(drawX + 130, drawY + 70, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(before => document.querySelector("canvas.excalidraw__canvas.static").toDataURL() !== before, before);
  await page.mouse.dblclick(drawX + 55, drawY + 35);
  const textEditor = page.locator("textarea.excalidraw-wysiwyg");
  await textEditor.fill("Offline Canvas");
  assert.match(await textEditor.evaluate(element => getComputedStyle(element).fontFamily), /Virgil/);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => [...document.fonts].some(face => face.family === "Virgil" && face.status === "loaded"));
  assert.ok(requests.some(url => url.startsWith("app://folio/excalidraw/fonts/Virgil/") && url.endsWith(".woff2")),
    "The hand-written font did not load through app://");
  const violations = await page.evaluate(() => globalThis.canvasDocumentViolations);
  assert.equal(violations.length, 0, `Canvas hit CSP: ${violations.slice(0, 3).join(", ")}`);
  assert.deepEqual(requests.filter(url => /^https?:/i.test(url)), [], "Canvas attempted a network request");
  const firstScene = await sceneImage();

  // Use the real Doko preference from Library and check the already-mounted reader.
  const initialTheme = await canvasDocumentEditor.evaluate(element => element.classList.contains("theme--dark") ? "dark" : "light");
  const nextTheme = initialTheme === "dark" ? "light" : "dark";
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  const shortcut = process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";
  await page.keyboard.press(shortcut);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("radio", { name: nextTheme === "dark" ? "Dark" : "Light", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Untitled Canvas", exact: true }).click();
  await page.waitForFunction(dark => document.querySelector(".excalidraw")?.classList.contains("theme--dark") === dark, nextTheme === "dark");
  assert.equal(await sceneImage(), firstScene, "Switching tabs or themes changed the drawing");

  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await welcome.click();
  await surface.waitFor();
  assert.equal(await firstTab.count(), 2, "Welcome should open a second Canvas");
  assert.equal(await sceneImage() === firstScene, false, "The second Canvas opened with the first one's drawing");
  assert.deepEqual(pageErrors, []);
  await assertHidden(app);
  console.log("PASS native File menu and Welcome open separate drawable Canvas tabs with offline fonts and live Doko theme");
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
