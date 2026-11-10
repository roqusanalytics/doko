import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, ".."), profile = mkdtempSync(path.join(tmpdir(), "doko-drop-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: profile, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath(env), env,
    args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
  const page = readerPage(await app.firstWindow());
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator(".textLayer span:not(.markedContent)").first().waitFor();
  await page.evaluate(() => {
    const tabs = window.frameElement.readerContext.tabs, open = tabs.open.bind(tabs);
    window.dropOpenedUrls = 0;
    // Fail safely if a regression skips the URL review gate; never contact the URL fixture.
    tabs.open = sources => {
      if (sources.some(source => source.kind === "url")) { window.dropOpenedUrls++; return tabs.active; }
      return open(sources);
    };
  });
  const gesture = (type, value = "https://example.invalid/review.pdf") => page.evaluate(({ type, value }) => {
    const data = new DataTransfer(); data.setData("text/plain", value);
    window.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
  }, { type, value });
  const review = page.getByRole("dialog", { name: "Open from URL" });
  for (const value of ["", "not a valid URL", "javascript:alert(1)"]) {
    await gesture("drop", value);
    assert.equal(await review.count(), 0, "Invalid text must not open the URL review");
    assert.equal(await page.evaluate(() => window.dropOpenedUrls), 0);
    if (await page.locator(".toast.error").isVisible()) await page.locator(".toast.error").click();
  }
  const long = "https://example.invalid/" + "x".repeat(12_000);
  await gesture("dragenter", long);
  await page.locator(".drop-overlay").waitFor();
  await gesture("drop", long);
  assert.equal(await review.getByLabel("PDF URL").inputValue(), long);
  assert.equal(await page.evaluate(() => window.dropOpenedUrls), 0, "A long URL must wait for explicit Open");
  assert.equal(await page.locator(".drop-overlay").count(), 0);
  await page.keyboard.press("Escape");
  await gesture("dragstart"); await gesture("drop"); await gesture("dragend");
  assert.equal(await review.count(), 0, "Internal text dragging must not open a document");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Organize pages…", exact: true }).click();
  const pages = page.getByRole("dialog", { name: "Manage pages" });
  await pages.waitFor();
  await gesture("drop");
  assert.equal(await review.count(), 0, "A document operation owns the drop gate");
  assert.equal(await pages.isVisible(), true);
  await page.keyboard.press("Escape");
  await pages.waitFor({ state: "detached" });
  await gesture("drop");
  await review.waitFor();
  assert.equal(await page.evaluate(() => window.dropOpenedUrls), 0);
  await page.keyboard.press("Escape");
  await assertHidden(app);
  console.log("PASS reader drop: empty/invalid text, long URL review, internal drag, operation gate and retry; zero automatic URL opens; hidden isolated app");
} finally {
  if (app) await closeHidden(app);
  rmSync(profile, { recursive: true, force: true });
}
