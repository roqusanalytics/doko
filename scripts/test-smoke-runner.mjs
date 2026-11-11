import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSteps } from "./run-smoke.mjs";

// Electron evaluators do not expose require; read OS capabilities in the Node test process.
for (const file of ["smoke-window-material.mjs", "smoke-window-appearance.mjs"]) {
  assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /\brequire\s*\(/, `${file} must import its Node helpers`);
}

const results = runSteps([["-e", "process.exit(0)"], ["-e", "process.exit(7)"], ["-e", "throw new Error('must not run')"]]);
assert.deepEqual(results.map(result => result.status), [0, 7]);
assert.ok(results.every(result => result.seconds >= 0));
console.log("PASS smoke runner preserves failure status, stops before later steps and records durations");
