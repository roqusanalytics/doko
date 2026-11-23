// Settings in localStorage go through src/preferences.ts, which turns a storage failure (site data blocked, no room
// left) into "unset" or "not saved" instead of an exception.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom" });
try {
  const { readSetting, writeSetting, removeSetting } = await server.ssrLoadModule("/src/preferences.ts");

  const saved = new Map();
  globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: key => saved.delete(key),
  };
  assert.equal(readSetting("folio:x"), null);
  assert.equal(writeSetting("folio:x", "1"), true);
  assert.equal(readSetting("folio:x"), "1");
  assert.equal(removeSetting("folio:x"), true);
  assert.equal(readSetting("folio:x"), null);

  const blocked = () => { throw new Error("storage blocked"); };
  globalThis.localStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };
  assert.equal(readSetting("folio:x"), null, "a blocked read reads as unset");
  assert.equal(writeSetting("folio:x", "1"), false, "a blocked write reports it wasn't saved");
  assert.equal(removeSetting("folio:x"), false, "a blocked remove reports it wasn't removed");

  // Without BroadcastChannel, listening for cleared data must not take the reader down.
  const channel = globalThis.BroadcastChannel;
  delete globalThis.BroadcastChannel;
  try {
    const { onStoredDataCleared } = await server.ssrLoadModule("/src/recent.ts");
    const stop = onStoredDataCleared(() => {});
    assert.equal(typeof stop, "function");
    stop();
  } finally { globalThis.BroadcastChannel = channel; }

  // Only preferences.ts touches localStorage, so this guard is the one place a storage failure is handled.
  const files = dir => readdirSync(dir).flatMap(name => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? files(file) : /\.(ts|tsx)$/.test(name) ? [file] : [];
  });
  const direct = files(path.join(root, "src"))
    .filter(file => path.relative(root, file) !== path.join("src", "preferences.ts") && /\blocalStorage\b/.test(readFileSync(file, "utf8")))
    .map(file => path.relative(root, file));
  assert.deepEqual(direct, [], "use readSetting / writeSetting / removeSetting from src/preferences.ts instead of localStorage");

  console.log("PASS preferences: storage failures read as unset or unsaved; only preferences.ts touches localStorage; clear-data listening works without BroadcastChannel");
} finally {
  await server.close();
}
