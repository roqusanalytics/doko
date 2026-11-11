import assert from "node:assert/strict";
import { mock, test } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

test("an off-screen visible window is hidden, but an on-screen one is rejected", async () => {
  let bounds = { x: -10000, y: -10000, width: 1000, height: 800 };
  const app = { evaluate: fn => fn({
    BrowserWindow: { getAllWindows: () => [{ isVisible: () => true, getBounds: () => bounds }] },
    app: { dock: { isVisible: () => false } },
    screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  }) };
  await assertHidden(app);
  bounds = { ...bounds, x: 10, y: 10 };
  await assert.rejects(assertHidden(app), /appeared on the user's screen/);
});


test("hidden cleanup prevents auto-quit before acknowledgement and refuses a non-test profile", async () => {
  const previous = process.env.FOLIO_TEST_USER_DATA;
  const calls = [];
  let autoQuit = true;
  const app = {
    evaluate: async fn => fn({ app: { removeAllListeners(name) { calls.push(name); autoQuit = false; } },
      BrowserWindow: { getAllWindows: () => [{ destroy() { if (autoQuit) throw new Error("Execution context was destroyed"); calls.push("destroy"); } }] } }),
    process: () => ({ pid: 12345, kill(signal) { calls.push(signal); } }),
    close: async () => { calls.push("close"); },
  };
  const taskkill = process.platform === "win32" ? mock.method(childProcess, "execFileSync", (command, args) => {
    assert.equal(command, "taskkill");
    assert.deepEqual(args, ["/PID", "12345", "/T", "/F"]);
    calls.push("kill-tree");
  }) : undefined;
  syncBuiltinESMExports();
  try {
    delete process.env.FOLIO_TEST_USER_DATA;
    await assert.rejects(closeHidden(app), /non-test profile/);
    assert.deepEqual(calls, []);
    process.env.FOLIO_TEST_USER_DATA = "synthetic-isolated-profile";
    await closeHidden(app);
    assert.deepEqual(calls, ["window-all-closed", "destroy", process.platform === "win32" ? "kill-tree" : "SIGKILL", "close"]);
  } finally {
    taskkill?.mock.restore();
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.FOLIO_TEST_USER_DATA;
    else process.env.FOLIO_TEST_USER_DATA = previous;
  }
});
