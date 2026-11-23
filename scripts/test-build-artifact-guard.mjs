import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temp = mkdtempSync(path.join(tmpdir(), "doko-artifact-guard-"));

try {
  for (const directory of ["dist", "src", "electron", "scripts"]) mkdirSync(path.join(temp, directory));
  const script = path.join(temp, "scripts/check-build-artifacts.mjs");
  copyFileSync(new URL("./check-build-artifacts.mjs", import.meta.url), script);
  assert.equal(spawnSync(process.execPath, [script]).status, 0);

  for (const directory of ["dist", "src", "electron", "scripts"]) {
    const alias = path.join(temp, directory, "Duplicate 2.ts");
    writeFileSync(alias, "// Synthetic sync duplicate");
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sync-conflict duplicate/);
    rmSync(alias);
  }

  console.log("PASS artifact guard blocks sync copies in source, Electron, scripts and built assets");
} finally { rmSync(temp, { recursive: true, force: true }); }
