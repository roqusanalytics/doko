import { assertHidden, closeHidden } from "./hidden-window.mjs";
// Takes the README screenshots in docs/screenshots: launches the built app on the sample document and captures
// all 11 README states using fictional documents and a local Ask AI response.
// No provider sign-in or network request is needed. Run `npm run build` first.
import { PDFDocument, PDFName, rgb } from "pdf-lib";
import assert from "node:assert/strict";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "docs", "screenshots");
mkdirSync(out, { recursive: true });

const env = { ...process.env, FOLIO_TEST_USER_DATA: mkdtempSync(path.join(tmpdir(), "folio-shots-")), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), args: [root, "--mute-audio", "--force-device-scale-factor=2"], env, timeout: 60_000 });
try {
  const page = readerPage(await app.firstWindow());
  assert.ok(await app.evaluate(({ app }) => app.commandLine.hasSwitch("mute-audio")));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 880));
  const shot = async (name, target = page) => {
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()), "#c5e1cb");
    await assertHidden(app);
    await page.waitForTimeout(800);
    await target.screenshot({ path: path.join(out, `${name}.png`) });
    console.log("saved", name);
  };
  const pageText = () => page.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
  // Startup reopens the last document, so a reload is how the theme changes here.
  const theme = async (name) => {
    await page.evaluate((name) => { localStorage.setItem("folio:theme", name); localStorage.setItem("folio:appearance", "default"); localStorage.removeItem("folio:panel-color"); localStorage.setItem("folio:default-colors-v1", "true"); }, name);
    await page.reload();
    await pageText();
  };
  const highlight = async (text, color) => {
    await page.evaluate((text) => {
      const span = [...document.querySelectorAll(".textLayer span:not(.markedContent)")].find((s) => s.textContent.includes(text));
      const range = document.createRange();
      range.selectNodeContents(span);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }, text);
    await page.locator(".selection-popover").waitFor();
    await page.getByRole("button", { name: `Highlight ${color}` }).click();
    await page.waitForTimeout(400);
  };

  await page.getByRole("button", { name: /Try a sample/ }).click({ timeout: 30_000 });
  await pageText();
  await theme("light");

  await highlight("A short tour of Doko", "yellow");
  await highlight("page. The sidebar on the left", "green");
  await highlight("Drag a PDF file anywhere", "pink");
  await page.getByRole("tab", { name: /Notes/ }).click();
  await page.getByLabel("Notes about this document").fill("Read before Thursday's review. Search and Ask AI are on pages 2 and 3.");
  await page.getByLabel("Note", { exact: true }).nth(1).fill("Thumbnails and outline both live here");
  await page.locator(".page").first().click({ position: { x: 20, y: 20 } });
  await shot("highlights-and-notes");

  // Reuse the smoke-test stream fixture so these captures never send document data to a provider.
  await app.evaluate(({ ipcMain }, answer) => {
    for (const name of ["folio:ai-status", "folio:ai-chatgpt-models", "folio:ai-ask"]) ipcMain.removeHandler(name);
    ipcMain.handle("folio:ai-status", () => ({ chatgpt: { connected: true, welcomeSeen: true }, claude: { installed: false } }));
    ipcMain.handle("folio:ai-chatgpt-models", () => ({ ok: true, models: [{ id: "demo", name: "Demo" }] }));
    ipcMain.handle("folio:ai-ask", (event, { id }) => {
      event.sender.send("folio:ai-event", { id, type: "delta", text: answer });
      event.sender.send("folio:ai-event", { id, type: "done" });
      return true;
    });
  }, "This sample is a tour of Doko's reading tools.\n\n- **Navigate:** scroll, use thumbnails or the outline, and adjust zoom. (p. 1)\n- **Highlight and annotate:** add color, notes, drawings, text, and a signature. (p. 2)\n- **Ask AI:** explore the document with page citations. (p. 3)\n- **Save or print:** keep a copy with your annotations. (p. 4)");
  await page.evaluate(() => localStorage.setItem("folio:ai-provider", "chatgpt"));
  await page.getByRole("tab", { name: /Pages/ }).click();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page.locator('[aria-label="Ask AI"] textarea').fill("What can I do with this document in Doko? Keep it short.");
  await page.keyboard.press("Enter");
  await page.getByTitle("Copy response as Markdown").waitFor();
  await shot("ask-ai");
  await page.getByLabel("Close Ask AI").click();

  const settings = page.getByRole("dialog", { name: "Settings" });
  const openSettings = () => page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await openSettings();
  await settings.getByRole("button", { name: "Ask AI", exact: true }).click();
  await settings.getByRole("button", { name: "Ask AI provider", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "OpenRouter", exact: true }).click();
  await settings.getByLabel("API key", { exact: true }).waitFor();
  assert.equal(await settings.getByLabel("API key", { exact: true }).inputValue(), "");
  await shot("openrouter-setup", settings);
  await settings.getByRole("button", { name: "Storage", exact: true }).click();
  await settings.locator(".stored-data summary").click();
  await settings.getByRole("button", { name: "Clear annotations…", exact: true }).waitFor();
  await settings.getByText("1 document", { exact: true }).first().waitFor();
  assert.ok(await settings.getByRole("button", { name: "Clear chats…", exact: true }).isEnabled());
  await shot("stored-data", settings);
  await settings.getByRole("button", { name: "General", exact: true }).click();
  await settings.getByRole("button", { name: /^Scan languages:/ }).click();
  const languages = page.getByRole("dialog", { name: "Choose scan languages" });
  await languages.getByRole("checkbox", { name: "Arabic", exact: true }).check();
  assert.ok(await languages.getByRole("checkbox", { name: "English", exact: true }).isChecked());
  await languages.getByRole("button", { name: /^Download ·/ }).waitFor();
  await shot("scan-languages", languages);
  await page.keyboard.press("Escape");
  await settings.getByRole("button", { name: "Close", exact: true }).click();

  await page.keyboard.press("ControlOrMeta+p");
  const print = page.getByRole("dialog", { name: "Print", exact: true });
  await print.getByRole("img", { name: "Preview of page 1", exact: true }).waitFor();
  await shot("print-preview", print);
  await print.getByRole("tab", { name: "Advanced", exact: true }).click();
  await print.getByRole("button", { name: "Booklet", exact: true }).click();
  await print.getByRole("img", { name: "Preview of sheet 1", exact: true }).waitFor();
  await shot("booklet-printing", print);
  await print.getByRole("button", { name: "Close", exact: true }).click();

  await theme("dark");
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByLabel("Find in document").fill("lighthouse");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /^\d+ of [1-9]\d*$/.test(document.querySelector(".search-status")?.textContent || ""));
  await shot("search");
  await theme("light");

  // A fictional four-page PDF supplies a real internal link and blank room for pen strokes.
  const pdf = await PDFDocument.create();
  const sheets = Array.from({ length: 4 }, () => pdf.addPage([612, 792]));
  for (const [index, sheet] of sheets.entries()) {
    if (index === 1) continue; // Blank notebook page for the pen-width comparison.
    sheet.drawText("Coastal field notes", { x: 54, y: 718, size: 28 });
    sheet.drawText(["Spring survey · Reading plan", "Habitats · Observation log", "Species · Research notes", "Summary · Next steps"][index], { x: 54, y: 680, size: 16 });
    sheet.drawText("A fictional notebook for exploring Doko.", { x: 54, y: 642, size: 12 });
    sheet.drawText(String(index + 1), { x: 550, y: 35, size: 11 });
  }
  sheets[0].drawText("Read the summary on page 4 →".replace("→", ">"), { x: 54, y: 590, size: 15, color: rgb(.19, .36, .25) });
  sheets[0].node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(pdf.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [50, 580, 310, 612], Border: [0, 0, 0], Dest: [sheets[3].ref, "Fit"],
  }))]));
  await app.evaluate(({ BrowserWindow }, bytes) => BrowserWindow.getAllWindows()[0].webContents.send(
    "folio:open-file", { name: "Coastal field notes.pdf", data: Buffer.from(bytes) }), [...await pdf.save()]);
  await page.window.waitForFunction(() => document.title.startsWith("Coastal field notes.pdf"));
  await pageText();
  await page.locator('.page[data-page-number="1"] .annotationLayer a').click();
  const back = page.getByRole("button", { name: "Back to page 1", exact: true });
  await back.waitFor();
  await back.focus(); // Keep the real return hint open while capturing both views.
  assert.equal(await page.getByLabel("Page number", { exact: true }).inputValue(), "4");
  const hintBox = await back.boundingBox();
  await shot("back-to-page", { screenshot: options => page.screenshot({ ...options, clip: {
    x: hintBox.x - 24, y: hintBox.y - 12, width: hintBox.width + 48, height: hintBox.height + 24,
  } }) });
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Back\b/ }).waitFor();
  await shot("pdf-link-history");
  await page.keyboard.press("Escape");
  await page.getByLabel("Page number", { exact: true }).fill("2");
  await page.getByLabel("Page number", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const layer = page.locator('.page[data-page-number="2"] .annotationEditorLayer.inkEditing');
  await layer.waitFor();
  const bounds = await layer.boundingBox();
  for (const [index, width] of ["Thin", "Medium", "Thick"].entries()) {
    await page.getByRole("button", { name: "Pen width", exact: true }).click();
    await page.getByRole("menuitemradio", { name: width, exact: true }).click();
    await page.mouse.move(bounds.x + 60, bounds.y + 280 + index * 45);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 330, bounds.y + 280 + index * 45, { steps: 16 });
    await page.mouse.up();
  }
  assert.equal(await page.locator('.page[data-page-number="2"] svg.draw').count(), 3);
  await page.getByRole("button", { name: "Pen width", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Thick", exact: true }).waitFor();
  const options = await page.getByRole("toolbar", { name: "Annotation options" }).boundingBox();
  await shot("pen-widths", { screenshot: args => page.screenshot({ ...args, clip: {
    x: Math.min(options.x, bounds.x + 40) - 12, y: options.y - 12,
    width: options.x + options.width - Math.min(options.x, bounds.x + 40) + 24,
    height: bounds.y + 420 - options.y,
  } }) });
} finally {
  await closeHidden(app);
  rmSync(env.FOLIO_TEST_USER_DATA, { recursive: true, force: true });
}
