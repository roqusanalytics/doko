import { flushAiHistory } from "./AiPanel";
import { bookmarksInOrder, type RecordResult, type SavedCopy } from "./documentState";
import type { MarkupController, MarkupState } from "./markup";
import { pdfBlob, type PDFDocumentProxy } from "./pdf";
import { contentKey, copySavedPdfData, getAiHistory, MAX_RECENT_FILE_BYTES } from "./recent";
import { saveVersion, type PdfChange } from "./versionHistory";

/** The parts of an open PDF that decide what a saved copy carries with it. */
type CopySource = {
  id: string;
  sourceId?: string;
  name: string;
  pdf: PDFDocumentProxy;
  password?: string;
  historyAllowed: boolean;
  edits?: { original?: Blob; changes: PdfChange[] };
};

export function changesForCopy(doc: Pick<CopySource, "edits">, annotated: boolean, order?: number[]) {
  const changes = [...(doc.edits?.changes ?? [])];

  if (annotated && !changes.some(change => change.kind === "annotations")) changes.push({ kind: "annotations" });

  if (order) changes.push({ kind: "pages", order });

  return changes;
}

/**
 * Before a PDF copy is written, decide which notes, bookmarks and Ask AI history travel with it, and read them.
 * The returned step stores them, and the copy's version history, under the saved bytes.
 */
export async function recordPdfSave(doc: CopySource, markup: MarkupController, gallery: boolean, pageOrder: number[] | undefined) {
  const copyDataAllowed = !!window.folioDesktop && !doc.password && !gallery &&
    await doc.pdf.getMetadata().then(({ info }) => !(info as { EncryptFilterName?: string }).EncryptFilterName).catch(() => false);

  let savedData: { notes: Pick<MarkupState, "note" | "bookmarkedPages">; generation: number; ai: Awaited<ReturnType<typeof getAiHistory>> } | undefined;

  if (copyDataAllowed) {
    markup.sync();
    await markup.flush();
    await flushAiHistory(doc.sourceId ?? doc.id);
    const state = markup.state;
    savedData = { notes: { note: state.note, bookmarkedPages: state.bookmarkedPages && bookmarksInOrder(state.bookmarkedPages, pageOrder) },
      generation: markup.storageGeneration, ai: await getAiHistory(doc.sourceId ?? doc.id) };
  }

  return async ({ bytes, blob, name, annotated }: SavedCopy): Promise<RecordResult> => {
    const changes = changesForCopy(doc, annotated, pageOrder);
    let dataMessage = "";

    if (savedData) {
      try {
        await copySavedPdfData(await contentKey(bytes), { ...savedData.notes, bookmarkedPages: savedData.notes.bookmarkedPages ?? [] }, savedData.generation, savedData.ai);
      } catch { dataMessage = "File saved. Couldn’t keep its document notes, bookmarks or conversation on this device."; }
    }

    let historyMessage = "";

    if (changes.length && doc.historyAllowed && blob.size <= MAX_RECENT_FILE_BYTES) {
      try {
        const original = doc.edits?.original ?? pdfBlob(await doc.pdf.getData());
        await saveVersion({ id: doc.sourceId ?? doc.id, name: doc.name, data: original },
          { id: await contentKey(bytes), name, data: blob }, changes);
      } catch { historyMessage = "Copy exported. Couldn’t save its version history on this device."; }
    } else if (changes.length) {
      historyMessage = "Copy exported. History is available for unencrypted PDFs up to 50 MB.";
    }

    return { dataFailed: !!dataMessage, messages: [historyMessage, dataMessage].filter(Boolean) };
  };
}
