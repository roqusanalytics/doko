import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = () => new Set(readdirSync(tmpdir()).filter(name => /^doko-(ai|gallery|editor|search)-test-cache-/.test(name)));
const before = names();
for (let trial = 0; trial < 2; trial++) {
  for (const name of ["ai-lifecycle", "gallery-image", "editor-session", "search-page-cache"]) {
    const result = spawnSync(process.execPath, [`scripts/test-${name}.mjs`], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual([...names()].filter(name => !before.has(name)), [], `cache left after ${name}, trial ${trial + 1}`);
  }
}
console.log("PASS two isolated runs of all four source tests leave no recreated Vite caches");
