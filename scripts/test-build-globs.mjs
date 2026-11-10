// Preserve Doko's packaging boundaries when the patched minimatch replaces transitive v9/v10.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const { FileMatcher } = require("app-builder-lib/out/fileMatcher");
const filter = new FileMatcher(root, path.join(root, "unused-package-destination"), value => value, pkg.build.files).createFilter();

for (const name of ["dist/index.html", "dist/.vite/license.md", "dist/assets/App-a.js", "dist/assets/žymė.js", "electron/main.cjs", "electron/preload.cjs", "package.json"]) {
  assert.equal(filter(path.join(root, name), { isDirectory: () => false }), true, `Package must retain ${name}`);
}
for (const name of ["dist/assets/App-a 2.js", "dist/assets 2/App-a.js", "dist/assets/App-a 12.js", "src/App.tsx", "reports/private.html", ".env"]) {
  assert.equal(filter(path.join(root, name), { isDirectory: () => false }), false, `Package must exclude ${name}`);
}
for (const name of ["dist", "dist/assets", "electron"]) {
  assert.equal(filter(path.join(root, name), { isDirectory: () => true }), true, `Package traversal must reach ${name}`);
}

// Universal uses matchBase for architecture-specific files and ASAR unpack allowlists.
const universalRequire = createRequire(require.resolve("@electron/universal"));
const { minimatch } = universalRequire("minimatch");
for (const [name, pattern, expected] of [
  ["Contents/Frameworks/libonly-x64.dylib", "libonly-x64.dylib", true],
  ["Contents/Frameworks/libother.dylib", "libonly-x64.dylib", false],
  ["node_modules/native/build/Release/binding.node", "*.node", true],
  ["node_modules/native/index.js", "*.node", false],
  ["Contents/Info.plist", "**/Info.plist", true],
  ["Contents/Other.plist", "**/Info.plist", false],
]) assert.equal(minimatch(name, pattern, { matchBase: true }), expected, `${name} against ${pattern}`);

console.log("PASS build glob boundaries: canonical files, sync aliases, private files, directory traversal and universal architecture/ASAR allowlists");
