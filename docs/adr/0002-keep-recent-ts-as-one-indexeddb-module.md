# 2. Keep recent.ts as the one IndexedDB module

Date: 2026-11-23. Status: accepted.

## Context

`src/recent.ts` is named after recent files but owns the whole `folio` IndexedDB database: recent files, document
notes, AI history, Canvas drafts, the schema upgrades, and the clear-data protocol (generation counters plus a
`BroadcastChannel`). `src/versionHistory.ts` uses the same database through `openFolioDatabase`. An architecture review
suggested splitting it into one module per store behind a common storage seam.

## Decision

Keep it as one module. Splitting it would mostly move code: every store shares one connection, one upgrade path and,
for notes and AI history, one generation check, so the split modules would keep reaching into each other and the
callers' interface would not get smaller. What did need fixing was smaller: localStorage access now goes only through
`src/preferences.ts`, and clearing data no longer depends on `BroadcastChannel` being available.

## Consequences

- One file to read for anything stored in IndexedDB, at the cost of a name narrower than what it holds.
- Revisit this when a second database appears, or when another reader needs its own reaction to cleared data and the
  reactions now spread across `App.tsx`, `ContentReader.tsx` and `CanvasReader.tsx` start to drift.

## Update, 2026-11-23

The reaction to cleared AI chats now lives in one place, `src/AiPanel.tsx`: it drops the kept conversations and
restarts any open panel, for every reader. `App.tsx` still clears its AI save error itself, and the reaction to cleared
annotations stays in `App.tsx`. The decision above is unchanged.
