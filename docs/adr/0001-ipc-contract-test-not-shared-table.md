# 1. Check the IPC contract with a test, not a shared channel table

Date: 2026-11-23. Status: accepted.

## Context

A desktop API crosses three hand-written layers: the handlers in `electron/*.cjs`, the bridge in
`electron/preload.cjs`, and the types in `src/desktop.d.ts`. Channel names are string literals typed in more than one
place, and nothing checked that the layers agree.

The natural deepening is one channel table that main, the preload and the types all derive from. But the main window's
preload runs with `sandbox: true`, and a sandboxed preload can `require` only `electron` (and a few Node built-ins),
not a local file. A shared table would need either a bundling step for the preload or code generated into it. Turning
the sandbox off is not an option (AGENTS.md, SECURITY.md).

## Decision

Keep the three layers hand-written and check them instead:

- `scripts/test-ipc-contract.mjs` (`npm run test:ipc-contract`, in CI) runs the preloads against a fake `electron`,
  records the channel each member reaches, and checks them against the main process's `handle`/`on` registrations
  and sends. It also checks that the bridge exposes no generic channel access, that every handler checks its sender,
  and that windows with a preload stay sandboxed and context-isolated.
- `electron/preload.cjs` is typed against `src/desktop.d.ts` (`tsconfig.preload.json`, part of `npm run build`), so
  missing, extra or mistyped members fail the build.

## Consequences

- Drift between the layers fails CI, and adding a desktop API still means editing three files.
- Revisit this when the preload gets a build step for another reason; a shared table then costs little.
