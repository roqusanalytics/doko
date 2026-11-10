// Requiring Electron can download it lazily; verify npm ci prepared offline test execution first.
import assert from "node:assert/strict";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const folder = path.dirname(require.resolve("electron/package.json"));
const metadata = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8"));
const pathFile = path.join(folder, "path.txt");
assert.ok(existsSync(pathFile), "npm ci must install Electron before the first require; run it online with lifecycle scripts enabled");
const binary = path.join(folder, "dist", readFileSync(pathFile, "utf8").trim());
assert.equal(readFileSync(path.join(folder, "dist/version"), "utf8").trim(), metadata.version);
assert.ok(statSync(binary).isFile(), "Electron's installed binary must exist");
accessSync(binary, process.platform === "win32" ? constants.F_OK : constants.X_OK);
console.log(`PASS Electron ${metadata.version} is installed before first require (${process.platform}/${process.arch})`);
