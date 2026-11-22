// Run after npm run build. Stub only the save dialog; Doko writes each file via its real IPC.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
import { readerPage } from "./reader-page.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-canvas-export-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio",
  ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const window = await app.firstWindow();
  window.setDefaultTimeout(10_000);
  const page = readerPage(window);
  const pageErrors = [];
  window.on("pageerror", error => pageErrors.push(error.message));
  const exportDialog = page.getByRole("dialog", { name: "Export a copy" });
  const exportAvailable = enabled => app.evaluate(({ Menu }, enabled) => {
    const file = Menu.getApplicationMenu().items.find(item => item.label === "File").submenu;
    return file.items.find(item => item.label === "Export / Convert…").enabled === enabled;
  }, enabled);
  const openExport = async () => {
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const file = Menu.getApplicationMenu().items.find(item => item.label === "File").submenu;
      const item = file.items.find(item => item.label === "Export / Convert…");
      if (!item.enabled) throw new Error("Canvas export is disabled");
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    });
    await exportDialog.waitFor();
  };

  const welcome = page.getByRole("button", { name: "New canvas", exact: true });
  await welcome.waitFor({ timeout: 30_000 });
  assert.equal(await exportAvailable(false), true, "Export should be disabled in the Library");
  await welcome.click();
  const surface = page.locator("canvas.excalidraw__canvas.interactive");
  await surface.waitFor();

  await openExport();
  assert.equal(await exportDialog.getByRole("checkbox", { name: "Selected Elements only" }).isDisabled(), true);
  const paddingInput = exportDialog.getByRole("spinbutton", { name: "Padding (px)" });
  for (const value of ["", "-1", "1001"]) {
    await paddingInput.fill(value);
    assert.equal(await paddingInput.evaluate(input => input.checkValidity()), false, "Invalid padding was accepted");
  }
  await paddingInput.fill("10");
  await exportDialog.getByRole("button", { name: "Prepare export" }).click();
  await exportDialog.getByRole("alert").filter({ hasText: "Add an Element to the Canvas" }).waitFor();
  await exportDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  const bounds = await surface.boundingBox();
  const x = Math.round(bounds.x + bounds.width * 0.35), y = Math.round(bounds.y + bounds.height * 0.35);
  const drawRectangle = async (left, top, right, bottom) => {
    await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();
  };
  await drawRectangle(x, y, x + 120, y + 70);
  await page.mouse.dblclick(x + 60, y + 35);
  await page.locator("textarea.excalidraw-wysiwyg").fill("Label");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => [...document.fonts].some(face => face.family === "Virgil" && face.status === "loaded"));
  await drawRectangle(x + 220, y + 90, x + 320, y + 150);
  await page.mouse.click(x + 60, y + 35);

  const sceneImage = () => page.locator("canvas.excalidraw__canvas.static").evaluate(element => element.toDataURL());
  const before = await sceneImage();
  const padding = 24;
  const saveExport = async ({ format, prefix, selectedOnly = false, background = true, darkMode = false }) => {
    const extension = format.toLowerCase();
    const filePath = path.join(temp, `${prefix}.${extension}`);
    await app.evaluate(({ dialog }, { filePath, extension }) => {
      dialog.showSaveDialog = async (_window, options) => {
        if (options.defaultPath !== `Untitled Canvas-export.${extension}`
            || options.filters[0].extensions[0] !== extension) throw new Error("Wrong export filename or format");
        return { canceled: false, filePath };
      };
    }, { filePath, extension });
    await openExport();
    if (format !== "PNG") {
      await exportDialog.getByRole("button", { name: "Export format" }).click();
      await exportDialog.getByRole("menuitemradio", { name: format, exact: true }).click();
    }
    await exportDialog.getByRole("checkbox", { name: "Selected Elements only" }).setChecked(selectedOnly);
    await exportDialog.getByRole("checkbox", { name: "Include background" }).setChecked(background);
    await exportDialog.getByRole("checkbox", { name: "Dark mode" }).setChecked(darkMode);
    await paddingInput.fill(String(padding));
    await exportDialog.getByRole("button", { name: "Prepare export" }).click();
    await exportDialog.getByRole("button", { name: "Save copy…" }).click();
    await exportDialog.waitFor({ state: "hidden" });
    return readFileSync(filePath);
  };

  const full = await saveExport({ format: "PNG", prefix: "full" });
  const dark = await saveExport({ format: "PNG", prefix: "dark", darkMode: true });
  assert.equal(await sceneImage(), before, "Dark export changed the drawing");
  const selected = await saveExport({ format: "PNG", prefix: "selected", selectedOnly: true, background: false });
  for (const png of [full, dark, selected]) {
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  const dimensions = png => [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.deepEqual(dimensions(full), [320 + 2 * padding, 150 + 2 * padding]);
  assert.deepEqual(dimensions(selected), [120 + 2 * padding, 70 + 2 * padding]);
  const corner = png => page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const sample = document.createElement("canvas");
    const context = sample.getContext("2d");
    context.drawImage(image, 0, 0);
    image.close();
    return [...context.getImageData(0, 0, 1, 1).data];
  }, png.toString("base64"));
  const lightCorner = await corner(full);
  const darkCorner = await corner(dark);
  assert.equal(lightCorner[3], 255);
  assert.ok(darkCorner[0] < lightCorner[0] && darkCorner[3] === 255, "Dark export should darken the background");
  assert.equal((await corner(selected))[3], 0, "Background should be transparent when disabled");

  const svg = (await saveExport({ format: "SVG", prefix: "selected", selectedOnly: true, background: false, darkMode: true })).toString("utf8");
  assert.ok(/<svg[\s>]/.test(svg), "Invalid SVG signature");
  const drawing = await page.evaluate(source => {
    const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
    return {
      type: root.localName, size: [root.getAttribute("width"), root.getAttribute("height")],
      text: root.querySelector("text")?.textContent, embeddedFont: root.querySelector("style")?.textContent.includes("data:font/woff2"),
      dark: root.getAttribute("filter")?.includes("invert"), background: !!root.querySelector("svg > rect"),
    };
  }, svg);
  assert.deepEqual(drawing, { type: "svg", size: ["168", "118"], text: "Label", embeddedFont: true, dark: true, background: false });
  const pdfBytes = await saveExport({ format: "PDF", prefix: "full" });
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  const pdf = await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 320 + 2 * padding, height: 150 + 2 * padding });
  assert.deepEqual(pageErrors, []);
  await assertHidden(app);
  console.log("PASS Canvas export: native menu, PNG/SVG/PDF, true bounds and padding, selection with bound text, embedded font, transparent background and dark export with unchanged Scene");
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
