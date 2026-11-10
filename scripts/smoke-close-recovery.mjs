import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
let realReader = false;
let failImport = false;
const directory = mkdtempSync(path.join(tmpdir(), "doko-close-recovery-"));
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "isolated-close-fixture", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (realReader) {
        if (failImport && req.url?.split("?")[0] === "/src/App.tsx") {
          failImport = false;
          res.statusCode = 503;
          res.setHeader("Cache-Control", "no-store");
          res.end("Synthetic transient reader import failure");
          return;
        }
        return next();
      }
      if (req.url !== "/" && req.url !== "/index.html?reader") return next();
      res.setHeader("Content-Type", "text/html");
      const html = req.url === "/" ? `<!doctype html><div id="root"></div><script type="module">
        import { DocumentTabs } from "/src/documentTabs.ts";
        import "/src/styles.css";
        import "/src/appearance.css";
        import * as React from "react";
        import { createRoot } from "react-dom/client";
        import { ReaderErrorBoundary } from "/src/ReaderErrorBoundary.tsx";
        window.fixtureReact = { React, createRoot, ReaderErrorBoundary };
        window.fixtureTabs = new DocumentTabs(document.getElementById("root"));
        await window.fixtureTabs.start();
      </script>` : '<!doctype html><title>Isolated synthetic reader</title><input aria-label="Pending note" value="Saved value">';
      server.transformIndexHtml(req.url, html).then(html => res.end(html), next);
    });
  } }] });
let app;
async function launch(name) {
  const bootstrap = path.join(directory, `${name}.cjs`);
  writeFileSync(bootstrap, `
    const { app, dialog } = require("electron");
    const { autoUpdater } = require(${JSON.stringify(path.join(root, "node_modules/electron-updater"))});
    global.closeFixture = { flushes: [], dialogs: [], requests: 0, quit: 0, update: 0, closed: false };
    global.fixtureUpdater = autoUpdater;
    autoUpdater.checkForUpdates = async () => ({ isUpdateAvailable: false });
    autoUpdater.quitAndInstall = () => { global.closeFixture.update++; };
    dialog.showMessageBox = async (_window, options) => {
      global.closeFixture.dialogs.push(options);
      return { response: global.fixtureDialogResponse ?? 0 };
    };
    require(${JSON.stringify(path.join(root, "electron/main.cjs"))});
  `);
  const env = { ...process.env, FOLIO_DEV_URL: server.resolvedUrls.local[0], FOLIO_TEST_HIDDEN: "1",
    FOLIO_TEST_USER_DATA: path.join(directory, name), FOLIO_UPDATE_TEST: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath(env), env,
    args: [bootstrap, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
  const page = await app.firstWindow();
  if (realReader) await page.frameLocator("iframe.document-reader").getByRole("heading", { name: "This reader stopped" }).waitFor();
  else await page.waitForFunction(() => window.fixtureTabs && document.querySelector("iframe.document-reader"));
  await app.evaluate(({ app, BrowserWindow }) => {
    app.removeAllListeners("window-all-closed");
    app.quit = () => {
      let prevented = false;
      app.emit("before-quit", { preventDefault() { prevented = true; } });
      if (!prevented) global.closeFixture.quit++;
    };
    const window = BrowserWindow.getAllWindows()[0];
    const send = window.webContents.send.bind(window.webContents);
    window.webContents.send = (channel, ...args) => {
      if (channel === "folio:prepare-close") { global.closeFixture.requests++; global.closeFixture.requestId = args[0]; }
      return send(channel, ...args);
    };
    window.webContents.on("console-message", (_event, _level, message) => {
      if (message.startsWith("CLOSE_FIXTURE_SAVED:")) global.closeFixture.flushes.push(message.split(":")[1]);
    });
    window.on("closed", () => { global.closeFixture.closed = true; });
  });
  await assertHidden(app);
  return page;
}
async function fixture(page, mode = "save", delay = 300) {
  await page.evaluate(() => {
    const tabs = document.querySelector("iframe.document-reader").readerContext.tabs;
    tabs.rename(tabs.all[0].key, "Notes and AI");
    tabs.library();
  });

  await page.waitForFunction(() => window.fixtureTabs.all.every(tab => tab.frame.contentDocument?.querySelector("input")));
  await page.evaluate(({ mode, delay }) => {
    const tabs = document.querySelector("iframe.document-reader").readerContext.tabs;
    window.closeTest = { mode, calls: 0, tabs };
    for (const [index, tab] of tabs.all.entries()) {
      tabs.rename(tab.key, index ? "Background notes" : "Notes and AI");
      tabs.bind(tab.key, { open() {}, canClose: async () => window.closeTest.mode !== "cancel", flush: async () => {
        window.closeTest.calls++;
        if (window.closeTest.mode === "fail") throw new Error("Synthetic storage failure");
        if (window.closeTest.mode === "timeout") await new Promise(resolve => setTimeout(resolve, 16000));
        else await new Promise(resolve => setTimeout(resolve, delay));
        localStorage.setItem(`close-fixture-${index}`, "Saved note and conversation");
        console.log(`CLOSE_FIXTURE_SAVED:${index}`);
      } });
    }
  }, { mode, delay });
}
const close = () => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
const state = () => app.evaluate(() => global.closeFixture);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await server.listen();
  let page;
  if (!process.argv.includes("--import-retry-only")) {
  page = await launch("native");
  await fixture(page);
  await close();
  await close();
  await sleep(75);
  const pending = await state();
  assert.equal(pending.closed, false, "window closed before delayed saves completed");
  assert.equal(pending.requests, 1, "repeated close started duplicate preparation");
  assert.equal(await page.evaluate(() => document.getElementById("root").inert), true, "readers remain editable during sequential flush");
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const sender = BrowserWindow.getAllWindows()[0].webContents;
    const id = global.closeFixture.requestId;
    ipcMain.emit("folio:prepared-close", { sender, senderFrame: sender.mainFrame.frames[0] }, id, "ready");
    ipcMain.emit("folio:prepared-close", { sender, senderFrame: sender.mainFrame }, "wrong-token", "ready");
    ipcMain.emit("folio:prepared-close", { sender, senderFrame: sender.mainFrame }, id, "invalid-result");
  });
  await sleep(75);
  assert.equal((await state()).closed, false, "invalid or child-frame acknowledgement closed the window");
  await sleep(225);
  assert.deepEqual((await state()).flushes, ["0"], "fixture must be between first and second reader flushes");
  await page.evaluate(() => document.querySelector("iframe").contentDocument.querySelector("input").focus());
  await page.keyboard.type("LATE EDIT");
  assert.equal(await page.evaluate(() => document.querySelector("iframe").contentDocument.querySelector("input").value), "Saved value");
  await sleep(800);
  assert.deepEqual((await state()).flushes, ["0", "1"]);
  assert.equal((await state()).closed, true);
  console.log("PASS native close flushes active/background notes and AI, deduplicates requests, rejects spoofed acknowledgements");
  await closeHidden(app); app = undefined;

  page = await launch("failure");
  await fixture(page, "fail");
  await close(); await sleep(150);
  assert.equal((await state()).closed, false);
  assert.match((await state()).dialogs[0].message, /Couldn't finish saving/);
  assert.equal(await page.evaluate(() => window.closeTest.tabs.all.length), 2);
  await page.evaluate(() => { window.closeTest.mode = "cancel"; });
  await close(); await sleep(150);
  assert.equal((await state()).closed, false);
  assert.equal((await state()).dialogs.length, 1, "cancel was incorrectly shown as a saving failure");
  await page.evaluate(() => { window.closeTest.mode = "save"; });
  await close(); await sleep(800);
  assert.equal((await state()).closed, true);
  console.log("PASS storage failure retains tabs and shows error; cancel retains window; retry flushes and closes");
  await closeHidden(app); app = undefined;

  page = await launch("timeout");
  await fixture(page, "timeout");
  await close(); await sleep(15200);
  assert.equal((await state()).closed, false);
  assert.match((await state()).dialogs[0].detail, /too long/);
  assert.equal(await page.evaluate(() => document.getElementById("root").inert
    || window.fixtureTabs.all.some(tab => tab.frame.contentDocument.documentElement.inert)), false);
  await page.evaluate(() => { window.closeTest.mode = "save"; });
  await page.waitForFunction(() => !window.closeTest.tabs.preparingClose);
  assert.equal((await state()).closed, false, "late acknowledgement bypassed timed-out close");
  await close(); await sleep(800);
  assert.equal((await state()).closed, true);
  console.log("PASS bounded timeout retains usable window, ignores late completion, permits retry");
  await closeHidden(app); app = undefined;

  page = await launch("quit");
  await fixture(page);
  await app.evaluate(({ app }) => { app.quit(); });
  await sleep(75);
  assert.equal((await state()).quit, 0);
  await sleep(800);
  assert.equal((await state()).quit, 1);
  assert.deepEqual((await state()).flushes, ["0", "1"]);
  console.log("PASS native quit awaits every reader flush");
  await closeHidden(app); app = undefined;

  page = await launch("update");
  await fixture(page);
  await app.evaluate(() => {
    global.fixtureUpdater.emit("update-downloaded", { version: "99.0.0" });
  });
  await page.evaluate(() => window.folioDesktop.installUpdate());
  await sleep(75);
  assert.equal((await state()).update, 0);
  await sleep(800);
  assert.equal((await state()).update, 1);
  assert.deepEqual((await state()).flushes, ["0", "1"]);
  console.log("PASS update restart awaits every reader flush without invoking installer/network");
  await closeHidden(app); app = undefined;

  page = await launch("update-failure");
  await fixture(page);
  await app.evaluate(() => {
    global.fixtureUpdater.quitAndInstall = () => { global.fixtureUpdater.emit("error", new Error("Synthetic installer failure")); };
    global.fixtureUpdater.emit("update-downloaded", { version: "99.0.0" });
  });
  await page.evaluate(() => window.folioDesktop.installUpdate());
  await sleep(800);
  assert.equal(await page.evaluate(() => document.getElementById("root").inert), false, "update error left readers frozen");
  await page.evaluate(() => { window.closeTest.mode = "cancel"; });
  await close(); await sleep(100);
  assert.equal((await state()).closed, false, "failed update retained close approval and bypassed later consent");
  await page.evaluate(() => { window.closeTest.mode = "save"; });
  await close(); await sleep(800);
  assert.equal((await state()).closed, true);
  console.log("PASS failed updater unfreezes readers and restores save/consent gate for the next close");
  await closeHidden(app); app = undefined;

  page = await launch("crash");
  await page.evaluate(async () => {
    const { React, createRoot, ReaderErrorBoundary } = window.fixtureReact;
    let fails = true;
    function Reader() { if (fails) throw new Error("Synthetic render failure"); return React.createElement("p", null, "Reader recovered"); }
    document.getElementById("root").hidden = true;
    const container = document.createElement("div"); document.body.append(container);
    createRoot(container).render(React.createElement(ReaderErrorBoundary,
      { onError() {}, onRecover: async () => { fails = false; } }, React.createElement(Reader)));
  });
  await page.getByRole("heading", { name: "This reader stopped" }).waitFor();
  mkdirSync(path.join(root, "release/smoke"), { recursive: true });
  await page.screenshot({ path: path.join(root, "release/smoke/reader-recovery.png") });
  await page.getByRole("button", { name: "Reopen saved document" }).click();
  await page.getByText("Reader recovered", { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.once("did-finish-load", () => resolve(true));
    contents.forcefullyCrashRenderer();
  }));
  assert.equal(await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return contents.executeJavaScript('Boolean(window.fixtureTabs && document.querySelector("iframe.document-reader"))');
  }), true);
  assert.equal((await state()).dialogs.length, 1);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(); });
  await sleep(400);
  const crashes = await state();
  assert.equal(crashes.dialogs.length, 2);
  assert.deepEqual(crashes.dialogs[1].buttons, ["Keep open"]);
  assert.match(crashes.dialogs[0].message, /Unsaved changes may have been lost/);
  assert.equal(readFileSync(path.join(directory, "crash/recovery.log"), "utf8").trim().split("\n").length, 2);
  await assertHidden(app);
  await close(); await sleep(100);
  assert.equal((await state()).closed, false, "crashed reader closed without explicit consent");
  await app.evaluate(() => { global.fixtureDialogResponse = 1; });
  await close(); await sleep(100);
  assert.equal((await state()).closed, true);
  console.log("PASS React recovery UI retries; renderer crash logged; one reload only; repeated crash stops recovery");
  await closeHidden(app); app = undefined;
  }

  realReader = true;
  failImport = true;
  page = await launch("import-retry");
  await page.evaluate(() => {
    const frame = document.querySelector("iframe.document-reader");
    const tabs = frame.readerContext.tabs;
    tabs.open([{ kind: "sample", name: "Pending sample" }]);
    tabs.library();
    window.recoverySibling = tabs.all.find(tab => tab.frame !== frame).frame;
    window.failedReader = frame;
    tabs.select(frame.readerContext.key);
  });
  await page.frameLocator("iframe.document-reader.active").getByRole("button", { name: "Reopen saved document" }).click();
  await page.frameLocator("iframe.document-reader.active").locator(".page canvas").first().waitFor();
  assert.equal(await page.evaluate(() => document.querySelector("iframe.document-reader.active") !== window.failedReader
    && window.recoverySibling.isConnected), true, "recovery failed to recreate only the failed frame");
  await assertHidden(app);
  console.log("PASS transient reader import retry recreates failed iframe, preserves undelivered sample, leaves sibling mounted");
} finally {
  if (app) await closeHidden(app);
  await server.close();
  rmSync(directory, { recursive: true, force: true });
}
