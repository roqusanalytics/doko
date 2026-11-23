# Document state

Extract the draft state of a reader tab out of `src/App.tsx` into one deep module, `src/documentState.ts`.
The term is defined in `GLOSSARY.md`.

## Goal

The dirty, save and undo logic can be tested with a Node unit test, without Electron.
A shorter `App.tsx` is a side effect, not the measure.

This is a pure refactor. Nothing the user sees changes: the unsaved mark, the close prompt, copy-or-original
routing and undo behave exactly as before. Bugs found on the way are written down below and fixed separately.

## Facts this design rests on

- Each document tab is its own `<iframe>` with its own `App`. One `App` holds one document or one photo gallery.
- `unsaved` is computed at `App.tsx:266` from eight inputs set in more than fifteen places.
- No PDF save overwrites the original; every save writes a copy.
- Dirty is cleared after a save only when `editRevision` did not change during the save.
- Operation undo is one level and holds the full bytes from before the operation.
- `src/session.ts` already exists and means reading position, hence the name Document state.

## Shape

- A class with `getState()` and `subscribe()`. React reads it with `useSyncExternalStore`, as `DocumentTabs` does.
- State has a gallery branch, `photos`: `null` for a single document, or `{ savedId, dirty, drafts }` when a photo
  folder is open. Each draft keeps a photo's bytes, whether it is unsaved, and its notes (opaque to the module).
- It knows the document identity (`id`, `sourceId`, name) and its revision. No PDF.js type crosses into it.
- Commands, not a generic dispatch: `opened`, `edited`, `setEditorDirty`, `setPageOrder`, `operationApplied`,
  `save()`, `undo()`.
- `save()` and `undo()` own their sequence and reach the outside through four adapters supplied by `App`:
  - `exportBytes(pageOrder)` → `{ bytes, annotated, blob, reading? } | null` (`currentBytes`; for a photo the blob
    is the PNG from `prepareDocumentExport`, and `reading` is its notes, kept with its draft)
  - `persist(blob, name, key, saveAs)` → `true` / `false` (cancelled); throws on failure
  - `reopen(name, bytes, pageOrder)` (PDF only)
  - `recordSave(pageOrder)` (PDF only) runs before the file is written (flushes notes and AI history) and returns
    the step that runs after it (`copySavedPdfData`, `saveVersion`), which reports `{ dataFailed, messages }`
- The text editor's `finish()` stays in `App`, before `save()` and `undoOperation()`: it can replace the
  document, so the document to save or undo is known only after it.
- `save()` returns `saved` / `cancelled` / `busy` and whether the document was reopened. `App` shows the message.
- Copy image (`exportPhoto("copy")`) also runs through `save()`, so only one export runs at a time. Its persist step
  writes to the clipboard and returns false: copying is not saving, so the photo stays unsaved.
- A second `save()` while one runs does nothing, as `exporting.current` does today.
- `undo()` returns the snapshot; `App` reopens it through `reopen`. View fields in the snapshot (`view`,
  `reading`, `pageMap`, `autoFit`) are opaque to the module.

## Outside the module

- `storageError` and `aiStorageError` are external flags fed in; the module only folds them into `unsaved`.
- PDF.js annotation undo and redo (`editingaction`) stays with PDF.js.
- Side exports stay in `App` and call `persistFile` directly: `exportPages`, `exportNotes`, the export dialog,
  version download, protect, redact, print copy. `savedTargets` stays with `persistFile`.
- `App` keeps reporting `tabs.markDirty(tabKey, unsaved)`. The module knows nothing about `DocumentTabs`.
- `suspend()` keeps its checks and reads `unsaved` and "has undo" from the store.
- `ContentReader` (Markdown, CSV and other content documents) keeps its own dirty and save path.

## Stages

Each stage is its own PR, and the existing smoke tests stay green after each.

1. Store and `unsaved`: `opened`, `edited`, `setEditorDirty`, `setPageOrder`, external flags, the revision
   guard. `App` reads `unsaved` from the store and the old formula is deleted.
2. Save sequence through the four adapters.
3. Operation undo and the work dialogs that apply a working copy.
4. Photo gallery.

### Stage 1 is done when

- `scripts/test-document-state.mjs` (Vite `ssrLoadModule` style, like `scripts/test-appearance.mjs`) covers
  the full `unsaved` truth table and "dirty clears only if the revision is unchanged".
- It runs as `npm run test:document-state` and as its own step in `.github/workflows/ci.yml`.
- `npm run build` passes.
- These smoke tests pass: `smoke-file-actions`, `smoke-pdf-save-data`, `smoke-text-markup`,
  `smoke-photo-tools`, `smoke-tab-suspension`, `smoke-close-recovery`.

## Found on the way, fix separately

- Closing a tab with an unsaved PDF shows a plain `window.confirm`, because `App`'s `tabs.bind` supplies no
  `canClose`. Markdown documents get a real Save / Discard dialog from `ContentReader`.
- `npm run test:document-tools` (`test-text-markup`, `test-pdf-pages`, `test-pdf-security`) is not run in CI.
