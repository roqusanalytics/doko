import assert from "node:assert/strict";
import { test } from "node:test";
import { assertHidden } from "./hidden-window.mjs";

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
