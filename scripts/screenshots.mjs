import { closeHidden } from "./hidden-window.mjs";
// Takes the README screenshots in docs/screenshots: launches the built app on the sample document and captures
// highlights and notes (light theme), Ask AI with a local demo response, and search (dark theme).
// No provider sign-in or network request is needed. Run `npm run build` first.
import assert from "node:assert/strict";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { _electron as electron } from "playwright-core";
import { mkdtempSync, mkdirSync } from "node:fs";
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
  const shot = async (name) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log("saved", name);
  };
  const pageText = () => page.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
  // Startup reopens the last document, so a reload is how the theme changes here.
  const theme = async (name) => {
    await page.evaluate((name) => localStorage.setItem("folio:theme", name), name);
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

  await theme("dark");
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByLabel("Find in document").fill("lighthouse");
  await page.keyboard.press("Enter");
  await shot("search");
} finally {
  await closeHidden(app);
}
