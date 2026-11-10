// Exercise the same anchored menus in the hidden Electron renderer used by the desktop app.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-menus-"));
const shots = path.join(root, "release", "smoke");
mkdirSync(shots, { recursive: true });
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const page = readerPage(await app.firstWindow());
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator('.page canvas').first().waitFor();
  const geometry = async label => {
    await page.waitForFunction(label => {
      const trigger = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.title === label);
      const popup = document.getElementById(trigger.getAttribute('aria-controls'));
      return popup?.matches(':popover-open') && popup.dataset.positioned === "true";
    }, label);
    const bounds = await page.evaluate(label => {
      const trigger = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.title === label);
      const popup = document.getElementById(trigger.getAttribute('aria-controls'));
      const box = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
      return { trigger: box(trigger), popup: box(popup), width: innerWidth, height: innerHeight, open: popup.matches(':popover-open') };
    }, label);
    assert.ok(bounds.open, `${label} is closed`);
    const { trigger: t, popup: p, width, height } = bounds;
    assert.ok(p.width > 0 && p.height > 0);
    assert.ok(p.left >= 7 && p.right <= width - 7 && p.top >= 7 && p.bottom <= height - 7, `${label} leaves the viewport: ${JSON.stringify(bounds)}`);
    assert.ok(p.bottom <= t.top - 5 || p.top >= t.bottom + 5, `${label} overlaps its trigger: ${JSON.stringify(bounds)}`);
    return bounds;
  };
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const tool = page.getByLabel("Drawing tool", { exact: true });
  await tool.focus(); await page.keyboard.press("ArrowDown");
  await page.getByRole("menuitemradio", { name: "Pen", exact: true }).waitFor();
  await geometry("Drawing tool");
  await page.screenshot({ path: path.join(shots, "drawing-menu.png") });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-checked')), 'true');
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Arrow');
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  assert.equal((await tool.innerText()).trim(), "Rectangle");
  assert.ok(await tool.evaluate(element => element === document.activeElement));
  await tool.click(); await page.keyboard.press("Escape");
  assert.ok(await tool.evaluate(element => element === document.activeElement));
  assert.ok(await page.getByRole("button", { name: "Done", exact: true }).isVisible(), "Escape from a menu left drawing mode");
  await tool.click(); await page.getByRole("menuitemradio", { name: "Pen", exact: true }).click();
  await tool.click();
  const width = page.getByLabel("Pen width", { exact: true });
  await width.click();
  assert.equal(await page.evaluate(() => document.querySelectorAll(':popover-open').length), 1, "two menus remained open");
  await geometry("Pen width");
  await page.keyboard.press("Escape");
  await tool.click(); await page.getByRole("radio", { name: "Black", exact: true }).click();
  assert.equal(await page.evaluate(() => document.querySelectorAll(':popover-open').length), 0, "outside click did not dismiss");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const zoom = page.getByTitle("Zoom", { exact: true });
  for (const edge of ['top', 'bottom']) {
    await zoom.evaluate((element, edge) => { element.style.cssText = `position:fixed;right:8px;${edge}:8px;z-index:1000`; }, edge);
    await zoom.click(); await geometry("Zoom");
    await page.keyboard.press("Escape");
  }
  await zoom.evaluate(element => element.removeAttribute('style'));
  await zoom.focus(); await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Automatic", exact: true }).waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.querySelectorAll(':popover-open').length), 0, "Tab did not dismiss the popup");
  await zoom.click(); await page.getByRole("menuitem", { name: "125%", exact: true }).click();
  assert.equal((await zoom.innerText()).trim(), "125%");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await geometry("More");
  await page.keyboard.press("Escape");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  const picker = page.getByRole("button", { name: /^Scan languages:/ });
  await picker.click();
  await geometry(await picker.getAttribute('aria-label'));
  const search = page.getByRole("searchbox", { name: "Search languages" });
  await search.fill(''); await search.fill('x'.repeat(1000));
  await page.getByText("No matching languages", { exact: true }).waitFor();
  await search.fill('English');
  const english = page.getByRole("checkbox", { name: "English", exact: true });
  await english.waitFor();
  await search.focus(); await page.keyboard.press("Tab");
  assert.ok(await english.evaluate(element => element === document.activeElement), "Tab did not reach the language checkbox");
  assert.equal(await page.evaluate(() => document.querySelectorAll(':popover-open').length), 1, "Tab closed the language dialog");
  const choices = page.locator('.scan-picker-options input[type="checkbox"]');
  for (let i = 1; i < await choices.count(); i++) {
    await page.keyboard.press("Tab");
    assert.ok(await choices.nth(i).evaluate(element => element === document.activeElement), "Tab skipped a visible language");
  }
  await page.keyboard.press("Tab");
  assert.ok(await page.getByRole("button", { name: "Apply", exact: true }).evaluate(element => element === document.activeElement), "Tab did not reach Apply");
  await page.keyboard.press("Shift+Tab");
  assert.ok(await choices.last().evaluate(element => element === document.activeElement), "Shift+Tab did not return to the language checkbox");
  await page.keyboard.press("Escape");
  assert.ok(await page.getByRole("dialog", { name: "Settings", exact: true }).isVisible(), "Escape from languages closed Settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Ask AI", exact: true }).click();
  await page.getByLabel("Ask AI provider", { exact: true }).click();
  await geometry("Ask AI provider");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(shots, "menus.png") });
  await assertHidden(app);
  assert.deepEqual(errors, []);
  console.log("ok  menus: non-overlapping anchor, viewport flip/clamp, selection, focus, arrows/Home/End/Escape, one popup, outside dismissal, language empty/long/search states");
} finally {
  await closeHidden(app);
  rmSync(temp, { recursive: true, force: true });
}
