// Real updater requests and content-reader controls, without downloads, a visible window or external links.
// Run after npm run build. FOLIO_UPDATE_APP may point at the packaged app.asar.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-updates-"));
const profile = path.join(temp, "profile");
mkdirSync(profile);
// No startup network request: each check below uses the local feed after it has been configured.
writeFileSync(path.join(profile, "update-settings.json"), JSON.stringify({ enabled: false }));
const config = path.join(temp, "updates.yml");
let version = "0.0.1", fail = false;
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  if (fail) { response.writeHead(503); response.end("Unavailable"); return; }
  assert.match(request.url, /^\/latest(?:-mac|-linux)?\.yml(?:\?|$)/, "unexpected artifact download");
  response.setHeader("Content-Type", "text/yaml");
  response.end(`version: ${version}\nfiles:\n  - url: Folio-mac.zip\n    sha512: ${Buffer.alloc(64).toString("base64")}\n    size: 1\npath: Folio-mac.zip\nsha512: ${Buffer.alloc(64).toString("base64")}\nreleaseDate: '2026-11-09T00:00:00.000Z'\n`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
writeFileSync(config, `provider: generic\nurl: http://127.0.0.1:${server.address().port}/\nupdaterCacheDirName: folio-update-test\n`);
const env = { ...process.env, FOLIO_TEST_HIDDEN: "1", FOLIO_TEST_USER_DATA: profile, FOLIO_UPDATE_TEST: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath(env), env,
    args: [process.env.FOLIO_UPDATE_APP || root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
  const window = await app.firstWindow();
  const page = readerPage(window);
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const metadata = await app.evaluate(({ app, shell }, config) => {
    const require = process.mainModule.require("node:module").createRequire(`${app.getAppPath()}/package.json`);
    require("electron-updater").autoUpdater.updateConfigPath = config;
    globalThis.updateLinks = [];
    shell.openExternal = async url => { globalThis.updateLinks.push(url); };
    const metadata = require("./package.json");
    const packagedFeed = require("node:path").join(app.getAppPath(), "..", "app-update.yml");
    return { local: metadata.folioLocal, target: metadata.build?.publish?.[0]
      ?? require("js-yaml").load(require("node:fs").readFileSync(packagedFeed, "utf8")) };
  }, config);
  assert.equal(metadata.local, true);
  assert.equal(metadata.target.owner, "roqusanalytics");
  assert.equal(metadata.target.repo, "folio");
  assert.equal(await app.evaluate(({ app }) => app.getName()), "Folio Local");
  assert.equal(requests.length, 0, "disabled startup checking accessed the update feed");
  await window.evaluate(() => {
    window.updateStates = [];
    window.folioDesktop.onUpdateStatus(status => window.updateStates.push(status));
  });
  const state = async expected => {
    await window.waitForFunction(expected => window.updateStates.at(-1)?.state === expected, expected);
    return window.evaluate(() => window.updateStates.at(-1));
  };
  const check = async expected => {
    await window.evaluate(() => { window.updateStates = []; window.folioDesktop.checkForUpdates(); });
    return state(expected);
  };
  await check("latest");
  assert.ok(requests.length > 0);
  assert.equal(await window.evaluate(() => window.folioDesktop.getAutoUpdateEnabled()), false);
  console.log("ok  disabled background checking still allows an explicit real feed check; no update is reported");

  const markdown = path.join(temp, "Notes.md");
  writeFileSync(markdown, "# Update check\n\nKeep this document open.\n");
  await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), markdown);
  await page.getByRole("textbox", { name: "Markdown source", exact: true }).waitFor();
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Updates", exact: true });
  await modal.getByText("You're up to date.", { exact: true }).waitFor();
  const toggle = modal.getByRole("switch", { name: "Automatic updates" });
  const beforeEnable = requests.length;
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Automatic updates"]')?.getAttribute("aria-checked") === "true");
  await state("latest");
  assert.ok(requests.length > beforeEnable, "enabling automatic checks did not query the feed");
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Automatic updates"]')?.getAttribute("aria-checked") === "false");
  assert.equal(JSON.parse(readFileSync(path.join(profile, "update-settings.json"))).enabled, false);
  console.log("ok  content reader can enable and disable background checks, with the preference saved");

  fail = true;
  await check("error");
  await modal.getByText(/Couldn't check for updates/).waitFor();
  fail = false;
  await modal.getByRole("button", { name: "Check for updates", exact: true }).click();
  await state("latest");
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  console.log("ok  failed checks show an error, and the same control retries successfully");

  // Unsigned Macs announce releases without attempting the native signed-update installation.
  if (process.platform === "darwin") {
    assert.equal(await window.evaluate(async () => (await window.folioDesktop.getAppInfo()).notifyOnly), true);
    version = "99.0.0";
    assert.equal((await check("available")).version, version);
    const download = () => page.getByRole("button", { name: `Download ${version}`, exact: true });
    await download().click();
    await window.waitForFunction(() => window.updateStates.at(-1)?.state === "available");
    const shots = path.join(root, "release", "smoke");
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, "updates-markdown.png") });
    const png = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 180), { width: 16, height: 16 }).toPNG().toString("base64"));
    const image = path.join(temp, "Photo.png");
    writeFileSync(image, Buffer.from(png, "base64"));
    await app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), image);
    await page.getByRole("region", { name: "Image gallery", exact: true }).waitFor();
    await download().click();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    await modal.getByRole("button", { name: `Download ${version}`, exact: true }).click();
    await page.screenshot({ path: path.join(shots, "updates-gallery.png") });
    await app.evaluate(async () => { for (let attempt = 0; attempt < 100 && globalThis.updateLinks.length < 3; attempt++) await new Promise(resolve => setTimeout(resolve, 20)); });
    const links = await app.evaluate(() => globalThis.updateLinks);
    assert.deepEqual(links, Array(3).fill("https://github.com/roqusanalytics/folio/releases/latest"));
    console.log("ok  unsigned Mac announces version 99.0.0 in Markdown, galleries and shared settings; every Download opens the fork release page");
  }
  await assertHidden(app);
} finally {
  await app?.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
