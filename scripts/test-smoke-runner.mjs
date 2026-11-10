import assert from "node:assert/strict";
import { runSteps } from "./run-smoke.mjs";

const results = runSteps([["-e", "process.exit(0)"], ["-e", "process.exit(7)"], ["-e", "throw new Error('must not run')"]]);
assert.deepEqual(results.map(result => result.status), [0, 7]);
assert.ok(results.every(result => result.seconds >= 0));
console.log("PASS smoke runner preserves failure status, stops before later steps and records durations");
