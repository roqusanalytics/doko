// Checks that the IPC contract agrees across its layers, without starting Electron:
// electron main handlers ↔ the preload bridges ↔ src/desktop.d.ts (via tsconfig.preload.json), plus the bridge's
// security rules. Why a test rather than one shared channel table: docs/adr/0001-ipc-contract-test-not-shared-table.md.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const electronDir = path.join(root, "electron");
const PRELOADS = { "preload.cjs": "folioDesktop", "screenshot-preload.cjs": "screenshot" };

// 1. Run each preload against a fake electron and record which channel every member reaches, and how.
function loadPreload(file) {
  const exposed = {};
  const calls = [];
  const listeners = [];
  const ipcRenderer = {
    invoke: (channel) => { calls.push({ kind: "invoke", channel }); return Promise.resolve({ data: [], mime: "", name: "", gallery: null }); },
    send: (channel) => { calls.push({ kind: "send", channel }); },
    on: (channel, listener) => { calls.push({ kind: "on", channel }); listeners.push(listener); },
    removeListener: () => {},
  };
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
    ipcRenderer,
    webUtils: { getPathForFile: () => "/file" },
  };
  const source = readFileSync(path.join(electronDir, file), "utf8");
  const sandboxedRequire = (name) => {
    assert.equal(name, "electron", `${file} requires "${name}": a sandboxed preload can only require electron`);
    return electron;
  };
  vm.runInNewContext(source, { require: sandboxedRequire, process: { platform: "test" }, Promise, Uint8Array, Error });
  return { exposed, calls, listeners, ipcRenderer };
}

function members(value, prefix = "") {
  return Object.entries(value).flatMap(([key, member]) => typeof member === "function" ? [[prefix + key, member]]
    : member && typeof member === "object" ? members(member, `${prefix}${key}.`) : []);
}

const preloadChannels = { invoke: new Set(), send: new Set(), on: new Set() };
for (const [file, global] of Object.entries(PRELOADS)) {
  const { exposed, calls, listeners, ipcRenderer } = loadPreload(file);
  assert.deepEqual(Object.keys(exposed), [global], `${file} must expose only window.${global}`);
  const api = exposed[global];
  const bridgeFunctions = new Set(Object.values(ipcRenderer));
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const member of Object.values(value)) {
      assert.ok(member !== ipcRenderer && !bridgeFunctions.has(member), `${file} exposes ipcRenderer itself`);
      walk(member);
    }
  };
  walk(api);

  // Strings go in where a channel could be smuggled; a generic bridge would then reach "probe:" channels.
  // Subscriptions get callbacks instead; one taking a channel argument would then record a function as its channel.
  for (const [name, member] of members(api)) {
    const callback = () => {};
    const args = name.split(".").at(-1).startsWith("on") ? [callback, callback] : ["probe:a", "probe:b", "probe:c"];
    await Promise.resolve(member(...args)).catch(() => {});
  }
  // Fire every listener once, so replies sent from inside one (folio:prepared-close) are recorded too.
  for (const listener of listeners) listener({}, { name: "", data: [], message: "", token: "" });
  await new Promise(resolve => setTimeout(resolve, 0));

  for (const { kind, channel } of calls) {
    assert.match(channel, /^folio:[a-z-]+$/, `${file} reaches "${channel}": every channel must be a fixed folio: name`);
    preloadChannels[kind].add(channel);
  }
}

// 2. Read what the main process registers and sends.
const mainFiles = readdirSync(electronDir).filter(file => file.endsWith(".cjs") && !(file in PRELOADS));
const handled = new Set(), heard = new Set(), mentioned = new Set();
for (const file of mainFiles) {
  const source = readFileSync(path.join(electronDir, file), "utf8");
  const lines = source.split("\n");
  for (const [, how, channel] of source.matchAll(/\b(?:ipcMain\.)?(handle|on)\(\s*["']([^"']+)["']/g)) {
    if (!channel.startsWith("folio:")) continue;
    (how === "handle" ? handled : heard).add(channel);
  }
  for (const [, channel] of source.matchAll(/["'](folio:[a-z-]+)["']/g)) mentioned.add(channel);

  // Every direct ipcMain registration must check its sender: main.cjs's two wrappers, or a handler that calls
  // trusted(event) first (the screenshot overlay). Everything else registers through those wrappers.
  lines.forEach((line, index) => {
    if (!/ipcMain\.\w+\(/.test(line)) return;
    const body = lines.slice(index, index + 3).join("\n");
    const ok = file === "main.cjs" ? /const (handle|on) = \(channel, listener\) => ipcMain\.(handle|on)\(channel/.test(line) && /isTrustedSender\(event\)/.test(body)
      : /trusted\(event\)/.test(body);
    assert.ok(ok, `electron/${file}:${index + 1} registers IPC without checking the sender:\n${line.trim()}`);
  });

  // Windows: nothing turns off isolation, and every window with a preload is sandboxed and isolated.
  assert.doesNotMatch(source, /sandbox:\s*false|contextIsolation:\s*false|nodeIntegration:\s*true/, `electron/${file} weakens window isolation`);
  lines.forEach((line, index) => {
    if (!/\bpreload:/.test(line)) return;
    const prefs = lines.slice(index, index + 4).join("\n");
    assert.match(prefs, /sandbox:\s*true/, `electron/${file}:${index + 1} has a preload without sandbox: true`);
    assert.match(prefs, /contextIsolation:\s*true/, `electron/${file}:${index + 1} has a preload without contextIsolation: true`);
  });
}

// 3. Both sides agree, in both directions.
const sorted = set => [...set].sort();
assert.deepEqual(sorted(preloadChannels.invoke), sorted(handled), "preload invoke channels and main handle() channels differ");
assert.deepEqual(sorted(preloadChannels.send), sorted(heard), "preload send channels and main on() channels differ");
for (const channel of preloadChannels.on) assert.ok(mentioned.has(channel), `preload listens to ${channel}, which the main process never sends`);

// 4. src/desktop.d.ts matches the preload's members and signatures.
execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.preload.json"], { cwd: root, stdio: "inherit" });

console.log(`PASS IPC contract: ${preloadChannels.invoke.size} invoke, ${preloadChannels.send.size} send, ${preloadChannels.on.size} events match the main process and src/desktop.d.ts; every handler checks its sender; preload windows stay sandboxed`);
