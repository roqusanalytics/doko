// Publish a new Doko version for Windows, macOS, and Linux:
//   1. bump the version and tag it, then push the source and tag to roqusanalytics/doko;
//   2. the "Release build" workflow (.github/workflows/release-build.yml) builds and checks the installers
//      for every platform on GitHub Actions;
//   3. this script downloads them and publishes a release on public roqusanalytics/doko.
// Installed copies using this repository receive updates automatically.
//
//   npm run release                      # 1.0.0 -> 1.0.1
//   npm run release -- minor             # 1.0.0 -> 1.1.0
//   npm run release -- patch --notes "Faster search, fixed printing"
//
// After the original tag-push build succeeds (including a rerun), resume publication with:
//   npm run release -- --publish-only
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkRelease, RELEASES_REPO } from "./check-release.mjs";
import { artifactIds, verifyPublicReleaseRepository, releaseBump, releaseFiles, selectBuild, selectCI, successfulAttempt, successfulCI, verifyReleaseTag, SOURCE_REPO, WORKFLOW, CI_WORKFLOW } from "./release-build.mjs";

const args = process.argv.slice(2);
const notesAt = args.indexOf("--notes");
const notes = notesAt >= 0 ? args[notesAt + 1] : "";
const publishOnly = args.includes("--publish-only");
const bump = releaseBump(args);
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  console.error(`Unknown version bump "${bump}". Use patch, minor, major, or an exact version like 2.0.0.`);
  process.exit(1);
}

// ELECTRON_RUN_AS_NODE (set by some hosts) makes Electron tooling behave like plain Node.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
// Arguments are passed directly (no shell), so values like release notes can contain any characters.
const gh = (ghArgs, opts = {}) => execFileSync("gh", ghArgs, { env: { ...env, GH_HOST: "github.com" }, encoding: "utf8", ...opts });
const api = (endpoint) => JSON.parse(gh(["api", "--hostname", "github.com", `repos/${SOURCE_REPO}${endpoint ? `/${endpoint}` : ""}`]));
const git = (...args) => execFileSync("git", args, { env, encoding: "utf8" }).trim();
const sourceUrl = `https://github.com/${SOURCE_REPO}.git`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

verifyPublicReleaseRepository(api);

if (!publishOnly) {
  if (execSync("git status --porcelain").toString().trim()) {
    console.error("Commit or stash your changes first — a release is built from committed code.");
    process.exit(1);
  }
  // Releases come from main as pushed. Compare commits rather than branch names, since a worktree's branch
  // often isn't called "main".
  execFileSync("git", ["fetch", "--quiet", sourceUrl, "main"], { env, stdio: "inherit" });
  if (git("rev-parse", "HEAD") !== git("rev-parse", "FETCH_HEAD")) {
    console.error("This checkout isn't at the latest main. Merge your work into main, then release from it, for example:\n"
      + "  git worktree add ../doko-release origin/main && cd ../doko-release && npm run release");
    process.exit(1);
  }
  run(`npm version ${bump} -m "Release v%s"`);
}
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a numeric release version.");
const tag = `v${version}`;
const ref = `refs/tags/${tag}`;
const tagObject = git("rev-parse", "--verify", ref);
const commit = git("rev-parse", "--verify", `${tagObject}^{commit}`);
if (JSON.parse(git("show", `${commit}:package.json`)).version !== version) throw new Error("The tagged source has a different package version.");
if (!publishOnly) {
  if (git("rev-parse", "HEAD") !== commit) throw new Error("The release tag differs from the commit being pushed.");
  // Use the configured Doko source repository even if this checkout has another push URL.
  execFileSync("git", ["push", "--atomic", sourceUrl, "HEAD:refs/heads/main", ref], { env, stdio: "inherit" });
}
verifyReleaseTag(api, tag, tagObject, commit);
const query = new URLSearchParams({ event: "push", branch: tag, head_sha: commit, per_page: "2" });
const findBuild = () => selectBuild(api(`actions/workflows/${WORKFLOW}/runs?${query}`), tag, commit);

// Find the build for this tag (it can take a few seconds to appear), then wait for it.
console.log(`\nWaiting for the ${tag} build on GitHub Actions…`);
let build = null;
for (let i = 0; i < 60 && !build; i++) {
  build = findBuild();
  if (!build) await sleep(5000);
}
if (!build) {
  console.error(`No "${WORKFLOW}" run found for ${tag}. Check https://github.com/${SOURCE_REPO}/actions`);
  process.exit(1);
}
const runId = build.id;
console.log(`Build: https://github.com/${SOURCE_REPO}/actions/runs/${runId}`);
try {
  gh(["run", "watch", String(runId), "--repo", SOURCE_REPO, "--exit-status", "--interval", "20"], { stdio: "inherit" });
} catch {
  console.error(`\nThe ${tag} build failed. Rerun the failed jobs, then use npm run release -- --publish-only. Source changes need a new tag.`);
  process.exit(1);
}

const attempt = successfulAttempt(findBuild(), runId);
const ciQuery = new URLSearchParams({ event: "push", branch: "main", head_sha: commit, per_page: "100" });
const findCI = () => selectCI(api(`actions/workflows/${CI_WORKFLOW}/runs?${ciQuery}`), commit);
console.log(`\nWaiting for full CI on main at ${commit}…`);
let ci = null;
for (let i = 0; i < 60 && !ci; i++) {
  ci = findCI();
  if (!ci) await sleep(5000);
}
if (!ci) successfulCI(ci);
gh(["run", "watch", String(ci.id), "--repo", SOURCE_REPO, "--exit-status", "--interval", "20"], { stdio: "inherit" });
successfulCI(findCI());
const getArtifactIds = () => artifactIds(api(`actions/runs/${runId}/artifacts?per_page=100`), build);
const ids = getArtifactIds();

const body = [
  notes || `Doko ${version}.`,
  "",
  "## Download",
  "- **Windows:** **Doko-Setup.exe** (updates itself), or **Doko-Portable.exe** to run without installing.",
  "- **macOS:** **Doko-mac.dmg** (Apple Silicon and Intel). For the first launch, use Open Anyway in System Settings → Privacy & Security if macOS blocks the app.",
  "- **Linux:** **Doko-linux-amd64.deb** for Ubuntu/Debian (after that, updates arrive with your system updates), or **Doko-linux-x86_64.AppImage** (updates itself) for other distributions.",
  "- **Repository migration:** copies configured for the retired doko-fork feed need one manual install. Copies already using doko update normally. Keep the existing profile to retain saved documents and settings.",
].join("\n");
const folder = mkdtempSync(path.join(tmpdir(), "doko-release-"));
try {
  gh(["run", "download", String(runId), "--repo", SOURCE_REPO, "--dir", folder], { stdio: "inherit" });
  const files = releaseFiles(folder);
  const notesFile = path.join(folder, "release-notes.md");
  writeFileSync(notesFile, body);
  verifyReleaseTag(api, tag, tagObject, commit);
  if (successfulAttempt(findBuild(), runId) !== attempt || getArtifactIds() !== ids) throw new Error("The build changed during download. Run --publish-only again.");
  successfulCI(findCI());
  verifyPublicReleaseRepository(api);
  gh(["release", "create", tag, "--repo", RELEASES_REPO, "--verify-tag", "--title", `Doko ${version}`, "--notes-file", notesFile, ...files], { stdio: "inherit" });
} finally {
  rmSync(folder, { recursive: true, force: true });
}

// Double-check what actually got published: every file present, every update feed at this version.
const { problems } = await checkRelease(tag);
if (problems.length) {
  console.error(`\nPublished, but the release is incomplete:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.log(`\nDoko ${version} is live for Windows, macOS, and Linux: https://github.com/${RELEASES_REPO}/releases/tag/${tag}`);
console.log("Copies using the doko update feed will see it within a few hours. Copies using the retired doko-fork feed need one manual install.");
