import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RELEASE_ARTIFACTS, RELEASES_REPO } from "./check-release.mjs";
import { artifactIds, releaseBump, releaseFiles, selectBuild, selectCI, successfulAttempt, successfulCI, verifyReleaseTag, SOURCE_REPO } from "./release-build.mjs";

const tag = "v1.2.3";
const commit = "a".repeat(40);
const build = {
  id: 42, event: "push", head_branch: tag, head_sha: commit, path: ".github/workflows/release-build.yml", head_repository: { full_name: SOURCE_REPO },
  status: "completed", conclusion: "success", run_attempt: 2,
};
const select = (...runs) => selectBuild({ total_count: runs.length, workflow_runs: runs }, tag, commit);
const ci = { ...build, id: 50, path: ".github/workflows/ci.yml", head_branch: "main" };
const ciHistory = (...runs) => ({ total_count: runs.length, workflow_runs: runs });

test("full CI must be from the exact main push, repository and workflow", () => {
  successfulCI(selectCI(ciHistory(ci), commit));
  assert.equal(selectCI(ciHistory(), commit), null);
  assert.throws(() => successfulCI(null), /Full CI/);
  for (const change of [{ head_sha: "b".repeat(40) }, { path: build.path }, { head_repository: { full_name: "example/fork" } },
    { event: "pull_request" }, { event: "workflow_dispatch" }, { head_branch: tag }, { id: "50" }]) {
    assert.throws(() => selectCI(ciHistory({ ...ci, ...change }), commit), /CI does not match/);
  }
  assert.throws(() => selectCI({ total_count: 2, workflow_runs: [ci] }, commit), /Incomplete/);
});

test("an older successful CI run cannot hide a newer run or rerun", () => {
  for (const change of [{ status: "queued", conclusion: null }, { status: "in_progress", conclusion: null },
    { conclusion: "failure" }, { conclusion: "cancelled" }, { conclusion: "skipped" }, { run_attempt: 0 }]) {
    const latest = { ...ci, ...change, id: 51 };
    assert.throws(() => successfulCI(selectCI(ciHistory(latest, ci), commit)), /Full CI/);
    assert.throws(() => successfulCI(selectCI(ciHistory(ci, latest), commit)), /Full CI/);
    assert.throws(() => successfulCI(selectCI(ciHistory({ ...ci, run_attempt: 3, ...change }), commit)), /Full CI/);
  }
  successfulCI(selectCI(ciHistory({ ...ci, run_attempt: 3 }), commit));
});

test("normal and resumed publication execute the CI gate and recheck it after download", (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "folio-publisher-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = readFileSync(new URL("./release.mjs", import.meta.url), "utf8")
    .replace('from "node:child_process"', 'from "./mock-process.mjs"')
    .replaceAll('"./check-release.mjs"', JSON.stringify(new URL("./check-release.mjs", import.meta.url).href))
    .replaceAll('"./release-build.mjs"', JSON.stringify(new URL("./release-build.mjs", import.meta.url).href));
  writeFileSync(path.join(folder, "release.mjs"), source);
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(path.join(folder, "mock-process.mjs"), `
    import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
    import path from "node:path";
    const build = ${JSON.stringify(build)}, ci = ${JSON.stringify(ci)}, manifest = ${JSON.stringify(RELEASE_ARTIFACTS)};
    let ciReads = 0;
    export function execSync(command) { appendFileSync("calls", command + "\\n"); return command.includes("rev-parse") ? build.head_sha : ""; }
    export function execFileSync(command, args) {
      appendFileSync("calls", JSON.stringify([command, ...args]) + "\\n");
      if (command === "git") {
        if (args[0] === "show") return JSON.stringify({ version: "1.2.3" });
        return build.head_sha;
      }
      if (args[0] === "api") {
        const endpoint = args.at(-1);
        if (endpoint.includes("git/ref/tags/")) return JSON.stringify({ ref: "refs/tags/v1.2.3", object: { sha: build.head_sha } });
        if (endpoint.endsWith("git/ref/heads/main")) return JSON.stringify({ object: { sha: build.head_sha } });
        if (endpoint.includes("/ci.yml/runs?")) {
          ciReads++;
          const failing = process.env.CI_SCENARIO === "failed" || (process.env.CI_SCENARIO === "rerun" && ciReads >= 3);
          return JSON.stringify({ total_count: 1, workflow_runs: [{ ...ci, ...(failing ? { conclusion: "failure" } : {}) }] });
        }
        if (endpoint.includes("/release-build.yml/runs?")) return JSON.stringify({ total_count: 1, workflow_runs: [build] });
        if (endpoint.includes("/artifacts?")) return JSON.stringify({ total_count: 3, artifacts: Object.keys(manifest).map((name, i) => ({ name, id: i + 1, expired: false, workflow_run: { id: build.id, head_sha: build.head_sha } })) });
        throw new Error("Unexpected API request " + endpoint);
      }
      if (args[0] === "run" && args[1] === "download") {
        const folder = args.at(-1);
        for (const [group, files] of Object.entries(manifest)) {
          mkdirSync(path.join(folder, group));
          for (const { name } of files) writeFileSync(path.join(folder, group, name), "");
        }
      }
      if (args[0] === "release") throw new Error("PUBLICATION_REACHED");
      return "";
    }
  `);
  for (const args of [[], ["--publish-only"]]) {
    for (const scenario of ["failed", "rerun", "success"]) {
      writeFileSync(path.join(folder, "calls"), "");
      const result = spawnSync(process.execPath, ["release.mjs", ...args], {
        cwd: folder, encoding: "utf8", env: { ...process.env, CI_SCENARIO: scenario },
      });
      const calls = readFileSync(path.join(folder, "calls"), "utf8");
      assert.equal(result.status, 1, result.stderr);
      assert.ok(calls.includes("/ci.yml/runs?event=push&branch=main&head_sha=" + commit));
      if (scenario === "success") {
        assert.match(result.stderr, /PUBLICATION_REACHED/);
        assert.ok(calls.includes('["gh","release","create"'));
      } else {
        assert.match(result.stderr, /Full CI/);
        assert.ok(!calls.includes('["gh","release","create"'));
        assert.equal(calls.includes('["gh","run","download"'), scenario === "rerun");
      }
    }
  }
});

test("the fork builds and publishes in its own repository", () => {
  assert.equal(SOURCE_REPO, "roqusanalytics/folio");
  assert.equal(RELEASES_REPO, SOURCE_REPO);
});

test("release bump is read with or without notes", () => {
  assert.equal(releaseBump([]), "patch");
  assert.equal(releaseBump(["minor"]), "minor");
  assert.equal(releaseBump(["major", "--notes", "Release notes"]), "major");
  assert.equal(releaseBump(["--notes", "Release notes", "1.17.0"]), "1.17.0");
  assert.equal(releaseBump(["--notes", "Release notes"]), "patch");
});

test("publisher requires the original tag object and a commit on canonical main", () => {
  const tagObject = "1".repeat(40), main = "b".repeat(40);
  const responses = new Map([
    [`git/ref/tags/${tag}`, { ref: `refs/tags/${tag}`, object: { sha: tagObject } }],
    ["git/ref/heads/main", { object: { sha: main } }],
    [`compare/${commit}...${main}?per_page=1`, { merge_base_commit: { sha: commit } }],
  ]);
  const verify = () => verifyReleaseTag(key => responses.get(key), tag, tagObject, commit);
  verify();
  responses.get(`compare/${commit}...${main}?per_page=1`).merge_base_commit.sha = "c".repeat(40);
  assert.throws(verify, /main branch/);
  responses.get("git/ref/heads/main").object.sha = commit;
  verify();
  responses.get(`git/ref/tags/${tag}`).object.sha = main;
  assert.throws(verify, /differs from the local tag/);
});

test("only a unique matching tag-push build can supply a successful attempt", () => {
  assert.equal(select(), null);
  assert.equal(successfulAttempt(select(build), 42), 2);
  for (const change of [{ event: "workflow_dispatch" }, { head_sha: "b".repeat(40) }, { head_branch: "main" },
    { path: ".github/workflows/ci.yml" }, { head_repository: { full_name: "example/fork" } }]) {
    assert.throws(() => select({ ...build, ...change }));
  }
  assert.throws(() => select(build, { ...build, id: 43 }));
  for (const change of [{ conclusion: "failure" }, { conclusion: "skipped" }, { status: "in_progress" }, { id: 43 }]) {
    assert.throws(() => successfulAttempt({ ...build, ...change }, 42));
  }
});

test("archives must be unexpired and belong to the same run and SHA", () => {
  const groups = Object.keys(RELEASE_ARTIFACTS);
  const archives = groups.map((name, i) => ({ name, id: i + 1, expired: false, workflow_run: { id: 42, head_sha: commit } }));
  const ids = (artifacts) => artifactIds({ total_count: artifacts.length, artifacts }, build);
  assert.equal(ids(archives), ids(archives.toReversed()));
  for (const change of [{ name: groups[1] }, { expired: true }, { workflow_run: { id: 44, head_sha: commit } },
    { workflow_run: { id: 42, head_sha: "b".repeat(40) } }]) {
    assert.throws(() => ids([{ ...archives[0], ...change }, ...archives.slice(1)]));
  }
  assert.notEqual(ids([{ ...archives[0], id: 4 }, ...archives.slice(1)]), ids(archives));
  assert.throws(() => ids([...archives, archives[0]]));
});

test("only manifest files from the correct platform directory can be published", (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "folio-release-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const [group, assets] of Object.entries(RELEASE_ARTIFACTS)) {
    mkdirSync(path.join(folder, group));
    for (const { name } of assets) writeFileSync(path.join(folder, group, name), "");
  }
  const mac = path.join(folder, "folio-macos");
  const win = path.join(folder, "folio-windows");
  const files = releaseFiles(folder);
  assert.ok(files.includes(path.join(mac, "Folio-mac.zip.blockmap")));
  assert.ok(files.includes(path.join(mac, "Folio-mac.dmg.blockmap")));
  writeFileSync(path.join(mac, "unrelated.exe"), "");
  assert.throws(() => releaseFiles(folder));
  rmSync(path.join(mac, "unrelated.exe"));
  renameSync(path.join(mac, "latest-mac.yml"), path.join(win, "latest-mac.yml"));
  assert.throws(() => releaseFiles(folder));
  rmSync(path.join(win, "latest-mac.yml"));
  mkdirSync(path.join(mac, "latest-mac.yml"));
  assert.throws(() => releaseFiles(folder));
});
