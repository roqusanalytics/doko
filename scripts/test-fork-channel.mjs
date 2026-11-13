import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repo = path.resolve(import.meta.dirname, "..");

test("Doko keeps installed application identities and uses the public Doko channel", () => {
  const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
  assert.equal(pkg.name, "folio-local");
  assert.equal(pkg.productName, "Doko");
  assert.equal(pkg.build.productName, "Doko");
  assert.equal(pkg.build.appId, "app.folio.local");
  assert.equal(pkg.build.linux.executableName, "folio-local");
  assert.equal(pkg.desktopName, "folio-local.desktop");
  assert.equal(pkg.build.nsis.shortcutName, "Doko");
  assert.equal(pkg.folioLocal, true);
  assert.equal(pkg.build.publish[0].owner, "roqusanalytics");
  assert.equal(pkg.build.publish[0].repo, "doko");
  const main = readFileSync(path.join(repo, "electron/main.cjs"), "utf8");
  assert.ok(main.includes('app.setName("Folio Local")'), "Keep the credential-store identity stable");
  const apt = readFileSync(path.join(repo, "scripts/apt-repo.sh"), "utf8");
  assert.ok(apt.includes('Release::Origin="Folio Local"'));
  assert.ok(apt.includes('Release::Label="Folio Local"'));
});

test("source metadata and releases use the public Doko repository", () => {
  const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
  assert.equal(pkg.repository.url, "https://github.com/roqusanalytics/doko.git");
  assert.deepEqual(pkg.build.publish, [{ provider: "github", owner: "roqusanalytics", repo: "doko", releaseType: "release" }]);
  for (const [file, url] of [
    ["electron/main.cjs", "https://github.com/roqusanalytics/doko/releases/latest"],
    ["src/ChangelogDialog.tsx", "https://github.com/roqusanalytics/doko/releases"],
  ]) {
    const source = readFileSync(path.join(repo, file), "utf8");
    assert.ok(source.includes(`"${url}"`), `${file} must link to public releases`);
    assert.ok(!source.includes("https://github.com/roqusanalytics/doko-fork/releases"));
  }
});

test("Linux installer keeps the fork's apt source and trust separate", () => {
  const install = readFileSync(path.join(repo, "build/linux/after-install.tpl"), "utf8");
  const remove = readFileSync(path.join(repo, "build/linux/after-remove.tpl"), "utf8");
  for (const script of [install, remove]) {
    assert.ok(script.includes("/usr/share/keyrings/folio-local-archive-keyring.gpg"));
    assert.ok(script.includes("/etc/apt/sources.list.d/folio-local.list"));
    assert.ok(!script.includes("/usr/share/keyrings/folio-archive-keyring.gpg"));
    assert.ok(!script.includes("/etc/apt/sources.list.d/folio.list"));
    assert.ok(!script.includes("Forward-Future"));
  }
  assert.ok(install.includes("https://github.com/roqusanalytics/doko/releases/latest/download"));
  assert.ok(install.includes("folio-local.list.disabled"));
});

test("Linux apt upgrade migrates the old managed URL and preserves administrator choices", { skip: process.platform === "win32" }, t => {
  const folder = mkdtempSync(path.join(tmpdir(), "doko-apt-source-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = path.join(folder, "folio-local.list");
  const disabled = `${source}.disabled`;
  const keyring = "/usr/share/keyrings/folio-local-archive-keyring.gpg";
  const oldEntry = `deb [arch=amd64 signed-by=${keyring}] https://github.com/roqusanalytics/doko-fork/releases/latest/download ./`;
  const newEntry = oldEntry.replace("/doko-fork/", "/doko/");
  const install = readFileSync(path.join(repo, "build/linux/after-install.tpl"), "utf8");
  const updateSource = install.slice(install.indexOf("# Migrate only our original entry"))
    .replaceAll("/etc/apt/sources.list.d/folio-local.list.disabled", disabled);
  const run = () => {
    const result = spawnSync("sh", ["-c", updateSource], {
      encoding: "utf8", env: { ...process.env, FOLIO_SOURCE: source, FOLIO_KEYRING: keyring },
    });
    assert.equal(result.status, 0, result.stderr);
  };
  run();
  assert.equal(readFileSync(source, "utf8"), `${newEntry}\n`);
  writeFileSync(source, `${oldEntry}\n`);
  run();
  assert.equal(readFileSync(source, "utf8"), `${newEntry}\n`);
  const custom = `${oldEntry}\n# Managed by administrator\n`;
  writeFileSync(source, custom);
  run();
  assert.equal(readFileSync(source, "utf8"), custom);
  writeFileSync(source, `${oldEntry}\n`);
  writeFileSync(disabled, "");
  run();
  assert.equal(readFileSync(source, "utf8"), `${oldEntry}\n`);
  rmSync(source);
  run();
  assert.throws(() => readFileSync(source), { code: "ENOENT" });
});

test("apt verification accepts the public trust root and refuses multiple keys or mismatched armor", { skip: process.platform === "win32" }, t => {
  const folder = mkdtempSync(path.join(tmpdir(), "folio-apt-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const dir of ["scripts", "build/linux", "artifacts", "bin"]) mkdirSync(path.join(folder, dir), { recursive: true });
  for (const file of ["scripts/apt-repo.sh", "package.json", "build/linux/folio-archive-keyring.asc", "build/linux/folio-archive-keyring.gpg"]) {
    copyFileSync(path.join(repo, file), path.join(folder, file));
  }
  // Stop after real GnuPG validates the checked-in public certificate; full signatures need Linux release artifacts.
  writeFileSync(path.join(folder, "bin/gpgv"), "#!/bin/sh\necho reached-signature-verification >&2\nexit 73\n", { mode: 0o755 });
  const run = () => spawnSync("bash", [path.join(folder, "scripts/apt-repo.sh"), "--verify-only", path.join(folder, "artifacts")], {
    encoding: "utf8", env: { ...process.env, PATH: `${path.join(folder, "bin")}${path.delimiter}${process.env.PATH}` },
  });
  let result = run();
  assert.equal(result.status, 73, result.stderr);
  assert.match(result.stderr, /reached-signature-verification/);
  const keyring = path.join(folder, "build/linux/folio-archive-keyring.gpg");
  const original = readFileSync(keyring);
  writeFileSync(keyring, Buffer.concat([original, original]));
  result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /exactly one public primary key/);
  writeFileSync(keyring, original);
  const armor = path.join(folder, "build/linux/folio-archive-keyring.asc");
  const armoredKey = readFileSync(armor);
  writeFileSync(armor, Buffer.concat([armoredKey, armoredKey]));
  result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Armored and binary archive keyrings differ/);
  assert.doesNotMatch(result.stderr, /reached-signature-verification/);
});


test("Windows Word registration cannot overwrite upstream Folio", () => {
  const installer = readFileSync(path.join(repo, "build/installer.nsh"), "utf8");
  assert.ok(!installer.includes("Folio.WordDocument"));
  assert.equal(installer.match(/FolioLocal\.WordDocument/g)?.length, 8);
});

test("Mac icon stays legible in default and dark system appearances", () => {
  const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
  assert.ok(pkg.build.mac.icon.endsWith(".icon"));
  const folder = path.join(repo, pkg.build.mac.icon);
  const icon = JSON.parse(readFileSync(path.join(folder, "icon.json"), "utf8"));
  const mark = icon.groups[0].layers[0];
  const luminance = solid => solid.slice(5).split(",").slice(0, 3).map(Number)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const appearance of [undefined, "dark"]) {
    const background = icon["fill-specializations"].find(s => s.appearance === appearance).value.solid;
    const foreground = mark["fill-specializations"].find(s => s.appearance === appearance).value.solid;
    const a = luminance(background), b = luminance(foreground);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 7, `${appearance || "default"} icon loses contrast`);
  }
  const svg = readFileSync(path.join(folder, "Assets", mark["image-name"]), "utf8");
  const original = readFileSync(path.join(repo, "brand/doko/logos/doko-mark-ink.svg"), "utf8");
  assert.equal(svg.match(/ d="([^"]+)"/)[1], original.match(/ d="([^"]+)"/)[1], "Preserve the approved mark");
});
