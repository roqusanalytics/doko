// Run after npm run build. Drive both Canvas entries with a hidden, disposable Doko window.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const shots = process.env.FOLIO_CANVAS_TOPBAR_SHOTS;
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
  await window.setViewportSize({ width: 1280, height: 800 });

  if (shots) mkdirSync(shots, { recursive: true });
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

  const toolbar = page.getByRole("toolbar", { name: "Tools" });
  const button = name => toolbar.getByRole("button", { name, exact: true });
  const moreTools = page.getByRole("menu", { name: "More tools", exact: true });
  const more = page.getByRole("menu", { name: "More", exact: true });
  const action = (menu, name) => menu.getByRole("menuitem", { name, exact: true });

  async function select(tool) {
    await button(tool).click();
    await toolbar.locator(`[aria-label="${tool}"][aria-pressed="true"]`).waitFor();
  }

  async function openMore() {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await more.waitFor();
  }

  const capture = async name => {
    if (shots) {
      await window.mouse.move(1, 1);
      await window.screenshot({ path: path.join(shots, name + ".png"), animations: "disabled" });
    }
  };

  for (const selector of [".App-toolbar", ".main-menu-trigger", ".default-sidebar-trigger", ".HintViewer"]) {
    await canvasDocumentEditor.locator(selector).first().waitFor({ state: "hidden" });
  }

  for (const tool of ["Select", "Hand", "Rectangle", "Diamond", "Ellipse", "Arrow", "Line", "Draw", "Text", "Eraser"]) {
    await select(tool);
  }

  await page.keyboard.press("3");
  await toolbar.locator('[aria-label="Diamond"][aria-pressed="true"]').waitFor();
  await page.keyboard.press("h");
  await toolbar.locator('[aria-label="Hand"][aria-pressed="true"]').waitFor();
  // Exercise the browser's real file-input chooser in the hidden window.
  const chooser = window.waitForEvent("filechooser");
  await button("Image").click();
  await (await chooser).setFiles({
    name: "pixel.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+xQAAAAASUVORK5CYII=", "base64"),
  });
  await toolbar.locator('[aria-label="Image"][aria-pressed="true"]').waitFor();
  await select("Select");

  await page.locator(".topbar-left .brand").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Toggle library sidebar");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Select");
  await button("Open").focus();
  await page.keyboard.press("Tab");
  assert.ok(await page.locator(".topbar-right .update-btn").evaluate(element => element === document.activeElement));
  await button("More tools").press("Enter");
  await moreTools.waitFor();
  await page.keyboard.press("End");
  assert.equal(await moreTools.getByRole("menuitemcheckbox", { name: "Lock tool" }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Home");
  await capture("canvas-more-tools");
  await action(moreTools, "Frame").click();
  await toolbar.locator('[aria-label="More tools"].on').waitFor();
  await button("More tools").click();
  assert.equal(await action(moreTools, "Frame").getAttribute("aria-current"), "true");
  await page.keyboard.press("Escape");
  await canvasDocumentEditor.focus();
  await page.keyboard.press("2");
  await toolbar.locator('[aria-label="Rectangle"][aria-pressed="true"]').waitFor();
  await button("More tools").click();
  await action(moreTools, "Laser pointer").click();
  await toolbar.locator('[aria-label="More tools"].on').waitFor();
  await button("More tools").click();
  assert.equal(await action(moreTools, "Laser pointer").getAttribute("aria-current"), "true");
  await page.keyboard.press("Escape");
  await canvasDocumentEditor.focus();
  await page.keyboard.press("1");
  await toolbar.locator('[aria-label="Select"][aria-pressed="true"]').waitFor();
  await button("More tools").click();
  await moreTools.getByRole("menuitemcheckbox", { name: "Lock tool" }).click();
  await button("More tools").click();
  assert.equal(await moreTools.getByRole("menuitemcheckbox", { name: "Lock tool" }).getAttribute("aria-checked"), "true");
  await moreTools.getByRole("menuitemcheckbox", { name: "Lock tool" }).click();

  await openMore();
  await capture("canvas-more");
  await action(more, "Library").click();
  await page.getByText("No items added yet...", { exact: true }).waitFor();
  assert.equal(await page.locator(".library-menu-browse-button").filter({ visible: true }).count(), 0);
  await page.locator('[data-testid="sidebar-close"]').click();

  const search = page.getByRole("button", { name: /^Search \(/ });
  await search.click();
  await canvasDocumentEditor.locator(".layer-ui__search input").waitFor();
  await search.click();
  await canvasDocumentEditor.locator(".layer-ui__search input").waitFor({ state: "hidden" });
  await openMore();
  await action(more, "Canvas background").click();
  const background = page.getByRole("dialog", { name: "Canvas background", exact: true });
  await background.getByLabel("Background color").fill("#f4f1e8");
  await background.getByRole("button", { name: "Apply" }).click();
  await page.waitForFunction(() => {
    const context = document.querySelector(".excalidraw__canvas.static")?.getContext("2d");

    return context?.getImageData(1, 1, 1, 1).data.join(",") === "244,241,232,255";
  });
  await openMore();
  await more.getByRole("menuitem", { name: /^Help \/ keyboard shortcuts/ }).click();
  await page.locator(".HelpDialog[role=dialog]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".HelpDialog[role=dialog]").waitFor({ state: "hidden" });
  await openMore();
  await action(more, "Reset the canvas").click();
  await page.locator(".clear-canvas__content").waitFor();
  // Close with the dialog's own Cancel: Escape depends on where focus lands, and the modal
  // backdrop blocks the toolbar until it has closed.
  await page.locator(".excalidraw-modal-container").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".excalidraw-modal-container .Modal__background").waitFor({ state: "detached" });
  await openMore();
  await action(more, "Properties").click();
  const properties = page.getByRole("dialog", { name: "Properties" });
  await properties.getByText("Excalidraw (UTF-8)").waitFor();
  await properties.getByRole("button", { name: "Close" }).click();
  await button("Open").click();
  const open = page.getByRole("menu", { name: "Open", exact: true });

  for (const name of ["New canvas", "PDF", "Markdown", "Photos", "Excel", "Word", "From URL…"]) {
    await action(open, name).waitFor();
  }

  await action(open, "From URL…").click();
  const urlDialog = page.getByRole("dialog", { name: "Open from URL", exact: true });
  await urlDialog.waitFor();
  await page.keyboard.press("Escape");
  await urlDialog.waitFor({ state: "hidden" });

  const before = await sceneImage();
  const bounds = await surface.boundingBox();
  assert.ok(bounds && bounds.width > 400 && bounds.height > 200, "Drawing surface did not fill the reader");
  const drawX = bounds.x + bounds.width * 0.45, drawY = bounds.y + bounds.height * 0.45;
  await select("Rectangle");
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

  const layout = () => page.evaluate(() => {
    const center = document.querySelector(".topbar-center .segmented").getBoundingClientRect();

    return {
      center: center.left + center.width / 2,
      right: [...document.querySelectorAll(".topbar-right :is(.update-btn, .icon-btn)")].map(button => button.getBoundingClientRect().left),
      focus: document.querySelector(".focus-mode-btn").getBoundingClientRect().left,
      height: document.querySelector(".topbar").getBoundingClientRect().height,
    };
  });

  const libraryTab = page.getByRole("tab", { name: "Library", exact: true });
  await libraryTab.click();
  await page.getByRole("button", { name: "Try a sample document" }).click();
  const pdfTab = page.getByRole("tab", { name: "Doko sample.pdf", exact: true });
  await pdfTab.waitFor();

  const chooseTheme = async name => {
    await page.keyboard.press(shortcut);
    await settings.getByRole("radio", { name, exact: true }).click();

    if (name === "Light") {
      await settings.getByRole("button", { name: "Paper background", exact: true }).click();
      const workArea = page.getByRole("textbox", { name: "Work area", exact: true });
      await settings.locator(".appearance-color", { has: workArea }).getByRole("button", { name: "Auto", exact: true }).click();
    }

    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "hidden" });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, name.toLowerCase());
  };

  const measure = async (theme, width, takeShots = false) => {
    await window.setViewportSize({ width, height: 800 });
    await pdfTab.click();
    await toolbar.waitFor();
    const pdf = await layout();

    if (takeShots) await capture("pdf-" + theme);
    await firstTab.click();
    await button("Rectangle").waitFor();
    const canvas = await layout();

    if (takeShots) await capture("canvas-" + theme);
    assert.ok(Math.abs(pdf.center - canvas.center) <= 2, `Toolbar centers at ${width}px: PDF ${pdf.center}, Canvas ${canvas.center}`);
    assert.deepEqual(canvas.right, pdf.right, `Trailing buttons at ${width}px`);
    assert.equal(canvas.focus, pdf.focus, `Focus button at ${width}px`);
    assert.equal(canvas.height, pdf.height, `Topbar height at ${width}px`);

    const overlap = await page.evaluate(() => {
      const bar = document.querySelector(".canvas-document-tools").getBoundingClientRect();

      return [...document.querySelectorAll(".topbar-left button, .topbar-right button.icon-btn")].some(button => {
        const control = button.getBoundingClientRect();

        return bar.right > control.left && bar.left < control.right && bar.top < control.bottom && bar.bottom > control.top;
      });
    });

    assert.equal(overlap, false, `Canvas tools overlap adjacent controls at ${width}px`);
    console.log(`${width}px center Δ=${Math.abs(pdf.center - canvas.center).toFixed(2)}px; right x=[${canvas.right}]; focus x=${canvas.focus}`);
  };

  await chooseTheme("Light");
  await measure("light", 1280, true);
  await pdfTab.click();
  await chooseTheme("Dark");
  await measure("dark", 1280, true);
  await measure("600px", 600, true);
  await measure("420px", 420);
  await measure("720px", 720);
  await measure("800px", 800);
  await measure("880px", 880);
  await window.setViewportSize({ width: 420, height: 800 });
  await button("More tools").click();
  await action(moreTools, "Diamond").click();
  await button("More tools").click();
  assert.equal(await action(moreTools, "Diamond").getAttribute("aria-current"), "true");
  await page.keyboard.press("Escape");
  await openMore();
  await action(more, "Library").click();
  await page.locator(".default-sidebar").waitFor();
  await page.locator('[data-testid="sidebar-close"]').click();
  await page.keyboard.press("Escape");
  await window.setViewportSize({ width: 1280, height: 800 });
  await select("Select");
  await window.emulateMedia({ reducedMotion: "reduce" });
  await button("Select").hover();
  assert.equal(await button("Select").locator("span").evaluate(label => getComputedStyle(label).transform), "none");
  await window.emulateMedia({ reducedMotion: "no-preference" });
  await pdfTab.click();
  await page.keyboard.press(shortcut);
  await settings.getByRole("switch", { name: "Window transparency", exact: true }).click();
  await page.keyboard.press("Escape");
  await firstTab.click();
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-window-transparency"));

  const alphas = await page.evaluate(() => {
    const sample = document.createElement("canvas").getContext("2d");
    const selected = document.querySelector(".canvas-document-tools button.on");
    sample.fillStyle = getComputedStyle(selected).backgroundColor;
    sample.fillRect(0, 0, 1, 1);
    const scene = document.querySelector("canvas.excalidraw__canvas.static").getContext("2d");

    return [sample.getImageData(0, 0, 1, 1).data[3], scene.getImageData(1, 1, 1, 1).data[3]];
  });

  assert.deepEqual(alphas, [255, 255], "Selected tool and Scene stay opaque with window transparency");

  // Exercise the focus layout without entering native fullscreen in a hidden window.
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = () => Promise.reject(new DOMException("Hidden window", "NotAllowedError"));
  });
  const focusMode = page.getByRole("button", { name: "Focus mode", exact: true });
  await focusMode.click();
  await page.locator(".canvas-document-reader[data-focus]").waitFor();
  await page.keyboard.press("Escape");
  await focusMode.waitFor();

  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await welcome.click();
  await surface.waitFor();
  assert.equal(await firstTab.count(), 2, "Welcome should open a second Canvas");
  assert.equal(await sceneImage() === firstScene, false, "The second Canvas opened with the first one's drawing");
  assert.deepEqual(pageErrors, []);
  await assertHidden(app);
  console.log("PASS Canvas tools, menus, offline drawing, live themes, and PDF toolbar alignment at 420/600/720/800/880/1280px");
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
