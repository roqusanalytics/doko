import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright-core";
import { preview } from "vite";
import { readerPage } from "./reader-page.mjs";
import { linkHistoryPdf } from "./smoke-reader-tools.mjs";

const root = path.resolve(import.meta.dirname, "..");
const server = await preview({ root, preview: { host: "127.0.0.1", port: 0 } });
let browser;

try {
  browser = await chromium.launch({ headless: true, args: ["--enable-automation", "--mute-audio"] });
  const cdp = await browser.newBrowserCDPSession();
  assert.ok((await cdp.send("Browser.getBrowserCommandLine")).arguments.includes("--mute-audio"));
  const tab = await browser.newPage();
  const page = readerPage(tab);
  await tab.route("**/sample.pdf", route => route.fulfill({ contentType: "application/pdf", body: Buffer.from(linkHistoryPdf()) }));
  await tab.goto(server.resolvedUrls.local[0]);
  const cards = page.getByRole("group", { name: "Document types" });
  await cards.waitFor();
  assert.equal(await cards.getByRole("button").count(), 4);

  for (const [name, accept] of [
    ["PDF", "application/pdf,.pdf"], ["Markdown", ".md,.markdown"],
    ["Photos", ".jpg,.jpeg,.png,.webp,.gif,.bmp,.avif"], ["CSV", ".csv"],
  ]) {
    const [chooser] = await Promise.all([
      tab.waitForEvent("filechooser"),
      cards.getByRole("button", { name, exact: true }).click(),
    ]);

    assert.equal(await chooser.element().getAttribute("accept"), accept);
    assert.equal(chooser.isMultiple(), true);
    await chooser.setFiles([]);
  }

  await page.getByRole("button", { name: /Try a sample/ }).click();
  assert.equal(await page.evaluate(() => !!window.folioDesktop), false);
  const open = page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Open", exact: true });
  await open.press("Enter");
  const menu = page.getByRole("menu", { name: "Open", exact: true });
  await menu.waitFor();
  assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["PDF", "Markdown", "Photos", "CSV", "From URL…"]);

  const [csv] = await Promise.all([
    tab.waitForEvent("filechooser"),
    menu.getByRole("menuitem", { name: "CSV", exact: true }).click(),
  ]);

  assert.equal(await csv.element().getAttribute("accept"), ".csv");
  await csv.setFiles([]);
  console.log("ok  Browser Edition PDF Open menu offers CSV and opens the filtered picker");

  const link = page.locator('.page[data-page-number="1"] .annotationLayer a');
  await link.nth(3).click();
  await page.getByRole("button", { name: "Back to previous spot", exact: true }).click();
  await link.first().click();
  const pageNumber = page.getByLabel("Page number");
  await page.waitForFunction(() => document.querySelector('[aria-label="Page number"]').value === "2");
  assert.equal(await page.locator(".link-return").count(), 0);

  // Put Doko between real browser-history entries in both directions. Observe the event
  // after dispatch as well: headless Chromium doesn't implement every browser accelerator.
  await tab.evaluate(async () => {
    for (const where of ["before", "reader", "after"]) history.pushState(null, "", "?location=" + where);
    const moved = new Promise(resolve => addEventListener("popstate", resolve, { once: true }));
    history.back();
    await moved;
  });
  const url = tab.url();
  await page.evaluate(() => {
    window.observedArrows = [];
    window.addEventListener("keydown", event => {
      if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        setTimeout(() => window.observedArrows.push(event.defaultPrevented), 0);
      }
    }, true);
  });
  const mac = process.platform === "darwin";

  const press = async (key, shouldPrevent) => {
    const length = await page.evaluate(() => window.observedArrows.length);
    await tab.keyboard.press("Alt+" + key);
    await page.waitForFunction(n => window.observedArrows.length > n, length);
    assert.equal(await page.evaluate(() => window.observedArrows.at(-1)), shouldPrevent);
    assert.equal(tab.url(), url);
  };

  await page.getByRole("button", { name: /^Search \(/ }).click();
  const search = page.getByRole("textbox", { name: "Find in document" });
  await search.fill("low tide");
  await press("ArrowLeft", !mac);

  if (mac) assert.equal(await search.evaluate(el => el.selectionStart), 4);
  await press("ArrowRight", !mac);

  if (mac) assert.equal(await search.evaluate(el => el.selectionStart), 8);
  assert.equal(await pageNumber.inputValue(), "2");
  await search.press("Escape");

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Keyboard shortcuts/ }).click();
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await modal.getByRole("button", { name: "Close", exact: true }).focus();
  await press("ArrowLeft", !mac);
  await press("ArrowRight", !mac);
  assert.ok(await modal.isVisible());
  assert.equal(await pageNumber.inputValue(), "2");
  await tab.keyboard.press("Escape");
  await page.locator(".viewer-container").focus();
  await press("ArrowLeft", true);
  assert.equal(await pageNumber.inputValue(), "1");
  await press("ArrowRight", true);
  assert.equal(await pageNumber.inputValue(), "2");
  console.log("ok  Browser Edition keeps fields and dialogs in place and traverses only PDF history while reading");
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
