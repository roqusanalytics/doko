# Working on Doko (notes for AI coding agents and maintainers)

Doko ships for **Windows, macOS, and Linux from one codebase**. Every change and every release must reach all three.

## Project map and local setup

Doko is a local-first PDF reader with a React/TypeScript renderer, Vite, and an Electron desktop shell.
Use Node.js 22.12 or newer and npm with the existing `package-lock.json`; CI uses Node.js 22 and `npm ci`.
Install dependencies with `npm ci`. `npm run dev` starts the browser edition; desktop-only features require Electron.
The `predev` and `prebuild` hooks copy PDF.js and OCR assets into `public/`; use the npm scripts to run these hooks.

- `src/main.tsx` starts `src/documentTabs.ts`; document frames render PDF `src/App.tsx` or `src/ContentReader.tsx`.
  Keep the imperative PDF.js lifecycle in mind: `main.tsx` deliberately omits React StrictMode.
- `src/content-source.ts` routes local formats. `electron/content-files.cjs` owns Markdown file and gallery
  capabilities; keep their file/folder identity separate from PDF content hashes and PDF session persistence.
- `src/pdf.ts` and `src/viewer.ts` handle PDF loading and viewing. `src/markup.ts` restores and saves annotations;
  `src/recent.ts` owns IndexedDB document data, and `src/session.ts` handles reading-position persistence.
- `src/AiPanel.tsx` and `src/ai.ts` implement the Ask AI UI; `electron/ai.cjs` handles desktop providers.
  Keep stored credentials in the main process. Preserve the existing privacy rules for password-protected PDFs
  (see [README.md](README.md#privacy)).
- Desktop APIs cross `electron/main.cjs` → `electron/preload.cjs` → `src/desktop.d.ts` → renderer callers.
  Update all affected layers together. Preserve sandboxing, context isolation, and the shared CSP in `electron/csp.cjs`.
- `site/` is the doko.lt landing page: a separate Astro (Vite) project with its own `package.json`; it is not part of the
  Electron build. Work inside `site/`: `npm ci`, `npm run dev` (LAN-reachable), `npm run build` (also runs
  `scripts/check-seo.mjs` on `dist/`). Page markup is `src/components/Landing.astro`, rendered in English at `/` and
  Lithuanian at `/lt/`; all copy (incl. FAQ, meta and JSON-LD text) lives only in `src/i18n/en.ts` and `lt.ts`
  (same shape; a missing LT key fails the build); the logo is imported from `brand/doko/logos/`. Third-party brand marks
  live only in `src/data/logos.ts`; keep their shapes unmodified and the footer trademark note in place.
  Hero screenshots in `public/mockups/` come from the real app: after a root `npm run build`, run
  `node site/scripts/capture-mockups.mjs` (throwaway profile, fictional documents; its selection step can be flaky).
- `scripts/` contains Node regression tests and Playwright-driven Electron smoke tests; `build/` contains packaging
  resources. Read [CONTRIBUTING.md](CONTRIBUTING.md) before contribution or release work and
  [SIGNING.md](SIGNING.md) before changing installer signing.

## Choosing checks

- `npm run build` type-checks and builds; `npx tsc --noEmit` checks types alone. Run the required smoke check below
  against the built app, extending the existing scripts when the changed flow is not covered.
- Run the affected regression tests from `package.json` and `.github/workflows/ci.yml`.
  For desktop URL, IPC, or security changes, include `npm run test:reader-security`.
  For Markdown or galleries, include `npm run test:content`; its Electron E2E also runs in `npm run smoke`.
  There is no generic `npm test` or lint script; use the actual commands in those files.
- Report local results separately from the Windows/macOS/Linux CI matrix; a check on one OS does not prove the others.

## Releasing: one way only

- One repository: public `roqusanalytics/doko` holds the source, CI, releases, and every update feed (`latest*.yml`,
  APT `Packages`/`InRelease`). Git `origin` must be `https://github.com/roqusanalytics/doko.git`; push branches and tags
  only there. `roqusanalytics/doko-fork` is the old repository: never push to it or publish releases there.
- Installed copies read updates from `roqusanalytics/doko`, so keep that repository public and keep every updater, APT
  and release URL pointing at it.

- `npm run build:local` prepares a private Apple Silicon Mac app with `electron-builder.local.cjs`, a separate
  identity/profile, the fork update feed, and no publication. It builds outside synced folders for codesigning.
  Public releases still use the procedure below.
- Keep the installed private Mac app only at `/Applications/Doko.app`. Existing `/Applications/Folio.app` installs are
  not renamed by this documentation change. Store rollback copies as verified `.zip`
  archives, never loose `.app` bundles that macOS can index or launch. Unregister archived backup/build bundles
  with `lsregister -u`; register only the installed app. Verify the archive before removing its loose bundle.
- **Release only with `npm run release`** (`-- minor`, `-- major`, `-- --notes "…"` as needed). It bumps the version,
  pushes the tag, waits for `.github/workflows/release-build.yml` to build and check the Windows, macOS, and Linux
  installers, then publishes all of them together and verifies the result with `scripts/check-release.mjs`.
- **Never publish by hand.** Don't run `gh release create`/`upload`, `electron-builder --publish`, or a
  single-platform `npm run dist:*` and upload the output. A release missing a platform leaves those users behind; the
  daily **Release check** workflow opens an issue when that happens.
- For a transient build failure, rerun the failed jobs on the original tag-push run. Once it succeeds,
  `npm run release -- --publish-only` resumes publication. A source fix on `main` needs a new version and tag.
- The release must start at the latest `main` (the script checks). It pushes to `main` by name, so it works from a
  worktree on any branch, e.g. `git worktree add ../doko-release origin/main`. If the run stops after the tag is
  pushed (a closed terminal, a restarted session), run `npm run release -- --publish-only` to finish it.
- **One release at a time.** Releases are built from committed, pushed code. If another session is working in the same
  checkout, coordinate: don't commit or release its uncommitted work, and use a separate `git worktree` for your own.

## Keeping every platform working

- CI (`.github/workflows/ci.yml`) builds and runs `npm run smoke` on Windows, macOS, and Linux for every push to `main`
  and every pull request. Keep it green on all three before releasing.
- Platform differences live in a few places; check them when you touch related code:
  - `electron/main.cjs`: window chrome (`titleBarOverlay` on Windows/Linux, traffic lights on macOS), file opening
    (argv on Windows/Linux, `open-file` on macOS), install kinds and update behavior (`installKind`, `NOTIFY_ONLY`).
  - `src/platform.ts`: `keys()` writes shortcuts as ⌘/⇧ on macOS. Use it for every shortcut shown in the UI.
  - `package.json` `build.win` / `build.mac` / `build.linux`, `build/linux/*.tpl` (the .deb's install scripts).
- Paths shown to users differ per OS; don't hard-code Windows paths or "Explorer" in UI or docs.

## How each platform gets updates

| Install | Update path |
| --- | --- |
| Windows installer | electron-updater reads `latest.yml`, installs silently |
| Windows portable | none (download again) |
| macOS | electron-updater reads `latest-mac.yml`; 1.20.0 and newer install updates signed with the same persistent certificate (see SIGNING.md); changing its identity requires a planned reinstall migration |
| Linux AppImage | electron-updater reads `latest-linux.yml`, replaces itself |
| Linux .deb | apt: the package adds Doko's signed repository (`Packages`/`InRelease` on each release, signed with the `APT_SIGNING_KEY` secret) |

All of these files are produced by the release build and published together; `scripts/check-release.mjs` lists them.

## Pull requests

- Open a pull request only when asked. One request is one pull request; fix one problem in each.
- Title: what changes for the user, in plain words ("Keep text boxes when a document is reopened"). Pull requests are
  squash-merged, so the title becomes the commit message on `main`.
- The body follows `.github/pull_request_template.md`: the problem, the change, the issue or approval, and how you
  checked it, including which platforms. End with the model and harness that did the work.
- Visible changes need before/after screenshots attached to the pull request; never commit them.
- Don't change the version or the changelog in a pull request; maintainers update both when releasing.
- When reviewing an outside pull request, check for a duplicate open pull request or issue first, then whether it fixes
  one problem, has the approval it needs (see CONTRIBUTING.md), and shows evidence on the platforms it touches.

## Code style

Match the surrounding code: comments explain why, not what; user-facing text is plain and short. Run
`npx tsc --noEmit`, `npm run build`, and `npm run smoke` before committing.

To check a change in the running app, use `npm run smoke` (extend it if it doesn't cover your change). It runs Doko
without a visible window (off-screen on Windows and Linux, never shown on macOS) and leaves the clipboard alone, so it
doesn't interrupt whoever is using the computer. A new script that launches Electron gets the binary from
`scripts/electron-path.mjs`, which keeps a hidden run out of the Dock on macOS. Don't open a visible window
(`npm run app`, `electron .`, `FOLIO_SMOKE_SHOW=1`) unless the user asks to see the app.

For hidden Electron test scripts, reuse `scripts/hidden-window.mjs`: Windows/Linux render off-screen, so `isVisible()` alone is not a visibility failure.

For hidden Electron scripts, use `closeHidden(app)` as the only final teardown. Do not destroy windows or call `app.exit()` before it: Linux/Windows can exit before the cleanup acknowledgement returns.
