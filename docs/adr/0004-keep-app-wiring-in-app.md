# 4. Keep document opening, gallery, viewer and keyboard wiring in App

Date: 2026-11-23. Status: accepted.

## Context

`src/App.tsx` is about 2,000 lines in one `App` function. An architecture review proposed shrinking it by extracting
the biggest clusters into hooks: document opening (`openBytes` and friends), the photo gallery, the PDF.js viewer
setup, and the keyboard handler.

A deletion test on each showed they would move code without concentrating any decision:

- `openBytes` writes about 30 pieces of App state and refs.
- `galleryRef` and `photoAutoFit` are read by seven or more other clusters.
- The viewer setup writes 12 setters and reads 10 refs.
- The keyboard handler reads about 40 values; ADR 0003 already covers its menu side.

Each hook would need most of App's state passed in and back out, so a reader would trace one more layer for the same
knowledge.

## Decision

Keep that wiring in `App.tsx`. Extract only decisions that end up with one owner and a small interface. So far:
`documentState.ts` (unsaved, save sequence, undo, photo drafts), the Ask AI clear reaction in `AiPanel.tsx`,
`bookmarksInOrder` in `documentState.ts`, and `recordPdfSave` in `pdfCopy.ts`.

## Consequences

- `App.tsx` stays large, but what remains in it is wiring between viewer, markup, tabs and UI state.
- Revisit an extraction when a cluster's inputs and outputs can be cut to a handful, for example if opening a document
  moves its state into `DocumentState`, or a second reader needs the same gallery or viewer code.
