import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-hand-tool-"));
const shots = path.join(root, "release", "smoke");
mkdirSync(shots, { recursive: true });
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronPath(env), env,
  args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
let page;
try {
  page = readerPage(await app.firstWindow());
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.locator(".page canvas").first().waitFor();
  const scroll = () => page.locator(".viewer-container").evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
  const gesture = async (dx, dy, finish = true) => {
    const box = await page.locator(".viewer-container").boundingBox();
    const x = box.x + box.width * 0.55, y = box.y + box.height * 0.5;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    if (finish) await page.mouse.up();
  };
  const checkPan = async kind => {
    await page.getByTitle("Zoom", { exact: true }).click();
    await page.getByRole("menuitem", { name: "200%", exact: true }).click();
    await page.waitForFunction(() => { const el = document.querySelector(".viewer-container"); return el.scrollWidth > el.clientWidth + 250 && el.scrollHeight > el.clientHeight + 250; });
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await page.getByRole("button", { name: "Hand", exact: true }).click();
    await page.locator(".hand-tool").waitFor();
    await page.locator(".viewer-container").evaluate(el => { el.scrollLeft = 200; el.scrollTop = 200; });
    const before = await scroll();
    await gesture(-90, -70);
    const after = await scroll();
    assert.ok(after.left >= before.left + 85 && after.top >= before.top + 65, `${kind}: hand did not pan right/down`);
    await gesture(60, 50);
    const back = await scroll();
    assert.ok(back.left <= after.left - 55 && back.top <= after.top - 45, `${kind}: hand did not pan left/up`);
    assert.equal(await page.locator(".hand-dragging").count(), 0);
    assert.equal(await page.locator(".inkEditor, .freeTextEditor").count(), 0, `${kind}: Hand added an annotation`);
    assert.equal(await page.evaluate(() => getSelection()?.toString()), "");
    await gesture(-10, -10, false);
    assert.equal(await page.locator(".hand-dragging").count(), 1);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(await page.locator(".hand-dragging").count(), 0, "blur left the cursor grabbing");
    await page.mouse.up();
    await page.screenshot({ path: path.join(shots, `hand-tool-${kind}.png`) });
    await page.getByRole("button", { name: "Select", exact: true }).click();
    assert.equal(await page.locator(".hand-tool").count(), 0);
    assert.notEqual(await page.locator(".viewer-container").evaluate(el => getComputedStyle(el).userSelect), "none");
    console.log(`ok  ${kind}: Hand replaces Draw, pans both axes/directions, releases on blur and restores Select`);
  };
  await checkPan("pdf");
  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 1600, height: 1200 });
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#dae8dc"; ctx.fillRect(0, 0, 1600, 1200);
    return canvas.toDataURL().split(",")[1];
  });
  const photo = path.join(temp, "Pan.png"); writeFileSync(photo, Buffer.from(png, "base64"));
  await app.evaluate(({ app }, photo) => app.emit("open-file", { preventDefault() {} }, photo), photo);
  await page.getByRole("button", { name: "View Pan.png", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".photo-status") && !!document.querySelector(".page canvas"));
  await checkPan("photo");
  await assertHidden(app); assert.deepEqual(errors, []);
  console.log(`PASS Hand tool (${process.platform})`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(shots, "hand-tool-failure.png") }).catch(() => {});
  throw error;
} finally { await closeHidden(app); rmSync(temp, { recursive: true, force: true }); }
