import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

// The formula App.tsx used before Document state, kept here as the oracle for the truth table.
const oracle = ({ storageError, aiStorageError, photos, doc, dirty, editorDirty, pageDraft }) => {
  const gallery = !!photos, photoSavedId = photos?.savedId ?? "", photoDirty = photos?.dirty ?? new Set();
  const pageOrder = pageDraft?.order.some((n, i) => n !== i + 1) ? pageDraft.order : undefined;
  const currentPhotoDirty = dirty || editorDirty || (!!doc && doc.id !== photoSavedId);
  return !!storageError || aiStorageError || (gallery ? currentPhotoDirty || photoDirty.size > 0
    : !!doc?.sourceId || dirty || editorDirty || (!!pageOrder && !pageDraft?.copy));
};

const server = await createServer({ root: path.resolve(import.meta.dirname, ".."), server: { middlewareMode: true }, appType: "custom" });
try {
  const { DocumentState } = await server.ssrLoadModule("/src/documentState.ts");

  // Full truth table: every combination of the eight inputs reaches the same unsaved as the old formula.
  const bools = [false, true];
  const docs = [null, { id: "a", name: "a.pdf", saveKey: "a" }, { id: "a", name: "a.pdf", saveKey: "a", sourceId: "s" }];
  const drafts = ["none", "same", "reordered", "reorderedCopy"];
  let cases = 0;
  for (const gallery of bools) for (const storageError of bools) for (const aiStorageError of bools)
  for (const doc of docs) for (const dirty of bools) for (const editorDirty of bools) for (const draft of drafts)
  for (const photoSaved of bools) for (const otherPhotoDirty of bools) {
    const state = new DocumentState(gallery);
    if (otherPhotoDirty) {
      state.opened({ id: "o", name: "other.jpg", saveKey: "o", photoName: "other.jpg" }, false);
      state.edited();
      state.leavePhoto(new Uint8Array([2]), null);
      state.closed();
      state.clean();
    }
    const opening = doc && gallery ? { ...doc, photoName: "photo.jpg" } : doc;
    if (opening) state.opened(opening, false);
    if (photoSaved && opening) state.photoOpened();
    if (storageError) state.setStorageError("Couldn't save notes");
    state.setAiStorageError(aiStorageError);
    if (dirty) state.edited();
    state.setEditorDirty(editorDirty);
    if (draft !== "none") state.setPageOrder(draft === "same" ? [1, 2, 3] : [2, 1, 3]);
    if (draft === "reorderedCopy") state.savedPageCopy(state.getState().pageOrder, new Uint8Array([1]));
    const snapshot = state.getState();
    assert.equal(snapshot.unsaved, oracle(snapshot),
      `unsaved mismatch: ${JSON.stringify({ gallery, storageError, aiStorageError, doc, dirty, editorDirty, draft, photoSaved, otherPhotoDirty })}`);
    cases++;
  }
  assert.equal(cases, 2 * 2 * 2 * 3 * 2 * 2 * 4 * 2 * 2);

  // A save clears dirty only if no edit happened while it ran.
  const saving = new DocumentState();
  saving.opened({ id: "a", name: "a.pdf", saveKey: "a" }, false);
  saving.edited();
  let revision = saving.getState().revision;
  assert.equal(saving.clean(revision), true);
  assert.equal(saving.getState().dirty, false);
  saving.edited();
  revision = saving.getState().revision;
  saving.edited(); // an edit lands during the save
  assert.equal(saving.clean(revision), false, "an edit during the save must keep the document dirty");
  assert.equal(saving.getState().unsaved, true);
  saving.clean(); // pdf.js reported a full save
  assert.equal(saving.getState().dirty, false);
  saving.restoreDirty();
  assert.equal(saving.getState().dirty, true);

  // Opening resets the draft; reopening a saved copy keeps the page order but forgets the saved copy.
  const pages = new DocumentState();
  pages.opened({ id: "a", name: "a.pdf", saveKey: "a" }, false);
  pages.edited(); pages.setEditorDirty(true); pages.setPageOrder([2, 1]);
  pages.savedPageCopy([2, 1], new Uint8Array([1]));
  assert.equal(pages.getState().pageDraft.copy, undefined, "a copy is remembered only for the exact order that was saved");
  pages.savedPageCopy(pages.getState().pageOrder, new Uint8Array([1]));
  assert.ok(pages.getState().pageDraft.copy);
  pages.opened({ id: "b", name: "b.pdf", saveKey: "b" }, true);
  assert.deepEqual(pages.getState().pageDraft, { order: [2, 1] });
  assert.equal(pages.getState().dirty, false);
  assert.equal(pages.getState().editorDirty, false);
  pages.opened({ id: "c", name: "c.pdf", saveKey: "c" }, false);
  assert.equal(pages.getState().pageDraft, null);
  pages.closed();
  assert.equal(pages.getState().doc, null);

  // Subscribers hear real changes only, and the snapshot stays stable between them.
  const notify = new DocumentState();
  let calls = 0;
  const stop = notify.subscribe(() => calls++);
  const before = notify.getState();
  notify.setEditorDirty(false);
  notify.forgetPhoto("x.jpg");
  notify.leavePhoto(new Uint8Array(), null);
  notify.clearPhotos();
  assert.equal(calls, 0);
  assert.equal(notify.getState(), before);
  notify.setEditorDirty(true);
  assert.equal(calls, 1);
  stop();
  notify.edited();
  assert.equal(calls, 1);

  // Save sequence, through fake adapters.
  const pdfDoc = { id: "a", name: "Report.pdf", saveKey: "report" };
  const fakes = (overrides = {}) => {
    const log = [];
    const adapters = {
      exportBytes: async pageOrder => { log.push(["export", pageOrder]); return { bytes: new Uint8Array([1]), annotated: false, blob: new Blob(["x"]) }; },
      persist: async (blob, name, key, saveAs) => { log.push(["persist", name, key, saveAs]); return true; },
      recordSave: async () => { log.push(["prepare"]); return async saved => { log.push(["record", saved.name]); return { dataFailed: false, messages: [] }; }; },
      reopen: async (name, bytes, pageOrder) => { log.push(["reopen", name, pageOrder]); },
      ...overrides,
    };
    return { log, adapters };
  };
  const opened = (doc, gallery = false) => { const state = new DocumentState(gallery); state.opened(doc, false); return state; };

  {
    const state = opened(pdfDoc);
    state.edited();
    const { log, adapters } = fakes();
    const result = await state.save({ format: "pdf", saveAs: true }, adapters);
    assert.deepEqual(result, { status: "saved", reopened: false, messages: ["File saved"] });
    assert.deepEqual(log.map(entry => entry[0]), ["export", "prepare", "persist", "record"], "notes are flushed before the file is written");
    assert.deepEqual(log[2], ["persist", "Report.pdf", "report:pdf", true]);
    assert.equal(state.getState().dirty, false);
    assert.equal(state.getState().saving, false);
  }
  {
    // An edited document gets " (edited)" and is reopened from its copy; a reordered one gets " (reordered)".
    const state = opened({ ...pdfDoc, sourceId: "s" });
    state.setPageOrder([2, 1]);
    const { log, adapters } = fakes();
    const result = await state.save({ format: "pdf", saveAs: false }, adapters);
    assert.deepEqual(result, { status: "saved", reopened: true, messages: [] });
    assert.equal(log.find(entry => entry[0] === "persist")[1], "Report (reordered) (edited).pdf");
    assert.deepEqual(log.at(-1), ["reopen", "Report (reordered) (edited).pdf", [2, 1]]);
  }
  {
    // A failed notes copy keeps the edited document open instead of reopening it.
    const state = opened({ ...pdfDoc, sourceId: "s" });
    const { log, adapters } = fakes({ recordSave: async () => async () => ({ dataFailed: true, messages: ["notes lost"] }) });
    const result = await state.save({ format: "pdf", saveAs: false }, adapters);
    assert.deepEqual(result, { status: "saved", reopened: false, messages: ["File saved", "notes lost"] });
    assert.ok(!log.some(entry => entry[0] === "reopen"));
  }
  {
    // A reordered copy is remembered so it can be opened; the order stays pending.
    const state = opened(pdfDoc);
    state.setPageOrder([3, 1, 2]);
    const result = await state.save({ format: "pdf", saveAs: true }, fakes({ exportBytes: async () => ({ bytes: new Uint8Array([7]), annotated: true, blob: new Blob(["x"]) }) }).adapters);
    assert.deepEqual(result.messages, ["Saved reordered copy"]);
    assert.deepEqual(state.getState().pageDraft.copy, new Uint8Array([7]));
    assert.equal(state.getState().unsaved, false);
  }
  {
    // An edit while the file is being written keeps the document dirty.
    const state = opened(pdfDoc);
    state.edited();
    const { adapters } = fakes({ persist: async () => { state.edited(); return true; } });
    await state.save({ format: "pdf", saveAs: true }, adapters);
    assert.equal(state.getState().dirty, true);
  }
  {
    // Cancel keeps everything; a second save while one runs is skipped.
    const state = opened(pdfDoc);
    state.edited();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const slow = state.save({ format: "pdf", saveAs: true }, fakes({ persist: async () => { await gate; return false; } }).adapters);
    assert.equal(state.getState().saving, true);
    assert.deepEqual(await state.save({ format: "pdf", saveAs: true }, fakes().adapters), { status: "skipped" });
    release();
    assert.deepEqual(await slow, { status: "cancelled" });
    assert.equal(state.getState().dirty, true);
    assert.equal(state.getState().saving, false);
  }
  {
    // Another export holding the PDF: a PDF save is skipped quietly, a photo save reports it.
    const busy = fakes({ exportBytes: async () => null }).adapters;
    assert.deepEqual(await opened(pdfDoc).save({ format: "pdf", saveAs: true }, busy), { status: "skipped" });
    const photo = await opened({ ...pdfDoc, photoName: "cliff.jpg", photoKey: "photo:cliff" }, true).save({ format: "png", saveAs: false }, busy);
    assert.equal(photo.status, "failed");
    assert.match(photo.error.message, /Another export is in progress/);
  }
  {
    // A document replaced while saving is not written, and its failure is not reported.
    const state = opened(pdfDoc);
    const { log, adapters } = fakes({ exportBytes: async () => { state.opened({ id: "b", name: "Other.pdf", saveKey: "other" }, false); return { bytes: new Uint8Array(), annotated: false, blob: new Blob() }; } });
    assert.deepEqual(await state.save({ format: "pdf", saveAs: true }, adapters), { status: "skipped" });
    assert.ok(!log.some(entry => entry[0] === "persist"));
  }
  {
    // A failure after the file was written puts dirty back for a PDF.
    const state = opened({ ...pdfDoc, sourceId: "s" });
    state.edited();
    const result = await state.save({ format: "pdf", saveAs: true }, fakes({ reopen: async () => { throw new Error("reopen failed"); } }).adapters);
    assert.equal(result.status, "failed");
    assert.equal(state.getState().dirty, true);
  }
  {
    // A photo saves as PNG next to its name and marks only that photo saved.
    const state = opened({ id: "s1", name: "sea.jpg", saveKey: "k", photoName: "sea.jpg" }, true);
    state.edited();
    state.leavePhoto(new Uint8Array([3]), null);
    state.opened({ id: "p1", name: "cliff.jpg", saveKey: "k", photoName: "cliff.jpg", photoKey: "photo:cliff" }, false);
    state.photoOpened();
    state.edited();
    const exported = new Uint8Array([4]);
    const { log, adapters } = fakes({ exportBytes: async () => ({ bytes: exported, annotated: false, blob: new Blob(["x"]), reading: "notes" }) });
    const result = await state.save({ format: "png", saveAs: false }, adapters);
    assert.deepEqual(result, { status: "saved", reopened: false, messages: ["Saved an edited PNG copy. Original unchanged."] });
    assert.deepEqual(log, [["persist", "cliff (edited).png", "photo:cliff:png", false]]);
    const { photos } = state.getState();
    assert.equal(photos.savedId, "p1");
    assert.deepEqual([...photos.dirty], ["sea.jpg"]);
    assert.deepEqual(photos.drafts.get("cliff.jpg"), { bytes: exported, dirty: false, reading: "notes" }, "the saved photo keeps its bytes and notes as its draft");
    assert.equal(state.getState().unsaved, true, "another photo still has unsaved changes");
  }

  // Photo gallery drafts.
  {
    const photo = (id, name) => ({ id, name, saveKey: "k", photoName: name });
    const state = new DocumentState(true);
    state.opened(photo("a1", "a.jpg"), false);
    state.photoOpened();
    assert.equal(state.getState().unsaved, false, "a photo just opened from its file is saved");
    state.leavePhoto(new Uint8Array([1]), "r");
    assert.equal(state.getState().photos.drafts.size, 0, "an unchanged photo without a draft keeps no draft");

    state.opened(photo("b1", "b.jpg"), false);
    state.photoOpened();
    state.edited();
    state.leavePhoto(new Uint8Array([2]), "b notes");
    assert.deepEqual(state.getState().photos.drafts.get("b.jpg"), { bytes: new Uint8Array([2]), dirty: true, reading: "b notes" });
    assert.deepEqual([...state.getState().photos.dirty], ["b.jpg"]);

    // Coming back to an edited draft keeps it unsaved even though nothing changed since.
    state.opened(photo("b2", "b.jpg"), false);
    state.photoOpened();
    assert.equal(state.getState().photos.savedId, "");
    assert.equal(state.getState().currentPhotoDirty, true);
    state.leavePhoto(new Uint8Array([3]), "b notes");
    assert.equal(state.getState().photos.drafts.get("b.jpg").dirty, true);

    state.forgetPhotoReadings();
    assert.deepEqual(state.getState().photos.drafts.get("b.jpg"), { bytes: new Uint8Array([3]), dirty: true }, "cleared notes are not brought back");
    state.forgetPhoto("b.jpg");
    assert.equal(state.getState().photos.drafts.has("b.jpg"), false);
    state.clearPhotos();
    assert.equal(state.getState().photos.dirty.size, 0);

    // A single document has no gallery branch; opening a folder adds one and keeps it.
    const single = new DocumentState();
    assert.equal(single.getState().photos, null);
    single.showGallery();
    const branch = single.getState().photos;
    single.showGallery();
    assert.equal(single.getState().photos, branch);
  }

  // Operation undo: one level, only for the document the operation produced.
  {
    const state = opened(pdfDoc);
    state.setPageOrder([2, 1]);
    const before = new Uint8Array([9]);
    state.opened({ id: "edited", name: "Report.pdf", saveKey: "report" }, false); // the operation's edited copy opens
    state.operationApplied(before, { view: "kept as is" });
    let snapshot = state.getState();
    assert.equal(snapshot.dirty, true);
    assert.equal(snapshot.pageDraft, null, "an operation consumes the pending page order");
    assert.equal(snapshot.canUndoOperation, true);
    assert.deepEqual(snapshot.operationUndo.details, { view: "kept as is" });

    // Refusals: pending page order, or the reopen step refusing, keep the undo.
    state.setPageOrder([2, 1]);
    let result = await state.undoOperation(async () => true);
    assert.equal(result.status, "failed");
    assert.match(result.error.message, /page reordering/);
    state.setPageOrder(null);
    result = await state.undoOperation(async () => { throw new Error("Undo your newer annotations first"); });
    assert.equal(result.status, "failed");
    assert.ok(state.getState().operationUndo);
    assert.deepEqual(await state.undoOperation(async () => false), { status: "skipped" });
    assert.ok(state.getState().operationUndo);

    // Success opens the earlier bytes, leaves the document dirty, and uses up the undo.
    let reopened;
    result = await state.undoOperation(async undo => { reopened = undo.bytes; state.opened({ id: "restored", name: "Report.pdf", saveKey: "report" }, false); return true; });
    assert.deepEqual(result, { status: "undone" });
    assert.equal(reopened, before);
    snapshot = state.getState();
    assert.equal(snapshot.operationUndo, null);
    assert.equal(snapshot.canUndoOperation, false);
    assert.equal(snapshot.dirty, true);
    assert.deepEqual(await state.undoOperation(async () => true), { status: "skipped" });
  }
  {
    // Another document opening makes the undo inapplicable, but it stays recorded (it still blocks tab suspension).
    const state = opened(pdfDoc);
    state.operationApplied(new Uint8Array([1]), null);
    state.opened({ id: "other", name: "Other.pdf", saveKey: "other" }, false);
    assert.ok(state.getState().operationUndo);
    assert.equal(state.getState().canUndoOperation, false);
    const result = await state.undoOperation(async () => true);
    assert.match(result.error.message, /newer content edit/);
  }

  console.log(`PASS document state: ${cases} unsaved cases, revision guard, page draft, subscriptions, save sequence, photo drafts, operation undo`);
} finally {
  await server.close();
}
