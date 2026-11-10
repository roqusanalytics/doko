// Exercise the production conversion helper in a hidden Electron renderer.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFNumber, PDFString } from "pdf-lib";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-document-export-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const asset = readdirSync(path.join(root, "dist/assets")).find(name => /^documentExport-.*\.js$/.test(name));
assert.ok(asset, "Build Doko before running the document export test");
const pdf = await PDFDocument.create(); pdf.addPage([80, 60]);
const form = pdf.getForm(); const field = form.createTextField("Name"); field.setText("Keep me"); field.addToPage(pdf.getPage(0), { x: 5, y: 5, width: 50, height: 15 });
const note = pdf.context.obj({ Type: "Annot", Subtype: "Text", Rect: [5, 35, 15, 45], Contents: PDFString.of("Preserve note"), F: PDFNumber.of(4) });
pdf.getPage(0).node.addAnnot(pdf.context.register(note));
const original = [...await pdf.save({ useObjectStreams: false })];
// Generated blank encrypted PDF; password is a public test fixture.
const locked = [...Buffer.from("JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGVjMzY0Y2RhMzY+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA4MCA2MCBdCi9QYXJlbnQgMiAwIFIKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1YgMgovUiAzCi9MZW5ndGggMTI4Ci9QIDQyOTQ5NjcyOTIKL0ZpbHRlciAvU3RhbmRhcmQKL08gPDQ2OGM5OTE0ZjA4MTNlZGM2NWEwNzJhZDhiYzVlNjNjZjRmMzljZjJkMmYwMDllMmFkNDE5NzBjNjRlNzFkMzg+Ci9VIDwxZjY5NGUwNDZiNTFjYjBhZDQ1MmQ1YjdiYmM3MmEwMzI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4Pgo+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNTkgMDAwMDAgbiAKMDAwMDAwMDExOCAwMDAwMCBuIAowMDAwMDAwMTY3IDAwMDAwIG4gCjAwMDAwMDAyNTkgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA2Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCi9JRCBbIDw2NjYxNjMzODMwMzE2MTMyNjM2MzM4NjUzOTY2NjUzODM5MzQ2MjM3MzEzNzMzNjI2NTM4MzE2NTM3NjQzMDM3PiA8NjY2MTYzMzgzMDMxNjEzMjYzNjMzODY1Mzk2NjY1MzgzOTM0NjIzNzMxMzczMzYyNjUzODMxNjUzNzY0MzAzNz4gXQovRW5jcnlwdCA1IDAgUgo+PgpzdGFydHhyZWYKNDc0CiUlRU9GCg==", "base64")];
const huge = await PDFDocument.create(); huge.addPage([10_000, 8_001]);
const multiple = await PDFDocument.create(); multiple.addPage(); multiple.addPage();
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const page = readerPage(await app.firstWindow());
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const result = await page.evaluate(async ({ asset, original, huge, multiple, locked }) => {
    const { prepareDocumentExport } = await import(new URL(`./assets/${asset}`, location.href).href);
    const signal = new AbortController().signal;
    const options = { format: "pdf", compress: true, quality: 0.8, maxEdge: 0 };
    const snapshot = { bytes: new Uint8Array(original), name: "draft.pdf", photo: false, page: 1 };
    const reject = async (snapshot, options, pattern, givenSignal = signal) => {
      try { await prepareDocumentExport(snapshot, options, givenSignal); } catch (error) {
        if (!pattern.test(String(error))) throw error;
        return;
      }
      throw new Error("Invalid export input was accepted");
    };
    await reject({ ...snapshot, bytes: new Uint8Array() }, options, /empty/);
    await reject({ ...snapshot, bytes: new TextEncoder().encode("not pdf") }, options, /PDF|header/);
    await reject(snapshot, { ...options, format: "gif" }, /supported/);
    await reject(snapshot, { ...options, quality: NaN }, /valid/);
    await reject(snapshot, { ...options, maxEdge: -1 }, /valid/);
    await reject({ ...snapshot, bytes: { byteLength: 301 * 1024 * 1024 } }, options, /300 MB/);
    const stop = new AbortController(); stop.abort();
    await reject(snapshot, options, /abort/i, stop.signal);
    await reject({ ...snapshot, page: 0 }, { ...options, format: "png" }, /existing page/);
    await reject({ ...snapshot, bytes: new Uint8Array(huge), photo: true }, { ...options, format: "png" }, /80 million/);
    await reject({ ...snapshot, bytes: new Uint8Array(multiple), photo: true }, { ...options, format: "png" }, /single photo/);
    const protectedSnapshot = { ...snapshot, bytes: new Uint8Array(locked), password: "folio-test" };
    const protectedPdf = await prepareDocumentExport(protectedSnapshot, { ...options, compress: false }, signal);
    if (String([...new Uint8Array(await protectedPdf.blob.arrayBuffer())]) !== String(locked)) throw new Error("PDF protection changed");
    const protectedPng = await prepareDocumentExport(protectedSnapshot, { ...options, format: "png", compress: false }, signal);
    if (protectedPng.blob.type !== "image/png") throw new Error("Protected PDF image export failed");
    await reject(protectedSnapshot, options, /cannot be compressed/);
    for (const name of ["", "x".repeat(10_000) + ".pdf"]) {
      const output = await prepareDocumentExport({ ...snapshot, name }, { ...options, compress: false }, signal);
      if (output.name !== (name ? "x".repeat(10_000) : "document") + "-export.pdf") throw new Error("Export name changed");
    }
    const optimized = await prepareDocumentExport(snapshot, options, signal);
    const unchanged = [...snapshot.bytes];
    const again = await prepareDocumentExport({ ...snapshot, bytes: new Uint8Array(await optimized.blob.arrayBuffer()) }, options, signal);
    const images = [];
    for (const format of ["png", "jpeg", "webp"]) {
      const output = await prepareDocumentExport(snapshot, { ...options, compress: false, format }, signal);
      const bitmap = await createImageBitmap(output.blob);
      images.push({ type: output.blob.type, width: bitmap.width, height: bitmap.height, name: output.name }); bitmap.close();
    }
    const png = await prepareDocumentExport({ ...snapshot, photo: true }, { ...options, compress: false, format: "png" }, signal);
    const bitmap = await createImageBitmap(png.blob);
    const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
    const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0); bitmap.close();
    const alpha = context.getImageData(79, 59, 1, 1).data[3]; canvas.width = canvas.height = 0;
    return { bytes: [...new Uint8Array(await optimized.blob.arrayBuffer())], unchanged, smaller: optimized.smaller, repeatedSmaller: again.smaller, images, alpha };
  }, { asset, original, locked, huge: [...await huge.save()], multiple: [...await multiple.save()] });
  assert.deepEqual(result.unchanged, original, "export mutated original bytes");
  assert.ok(result.smaller, "uncompressed PDF was not optimized");
  assert.equal(result.repeatedSmaller, false, "already optimized PDF falsely reports improvement");
  const saved = await PDFDocument.load(new Uint8Array(result.bytes));
  assert.equal(saved.getForm().getTextField("Name").getText(), "Keep me");
  const annotations = saved.getPage(0).node.Annots().asArray().map(ref => saved.context.lookup(ref));
  assert.ok(annotations.some(a => a.get(PDFName.of("Contents"))?.decodeText() === "Preserve note"), "PDF annotation lost");
  assert.deepEqual(result.images.map(({type,width,height}) => [type,width,height]), [["image/png",160,120],["image/jpeg",160,120],["image/webp",160,120]]);
  assert.equal(result.alpha, 0, "photo PNG transparency lost");
  assert.ok(result.images.every(image => image.name.includes("page-1")));
  await assertHidden(app);
  console.log("PASS document export: PDF forms/annotations, honest no-improvement, PNG/JPEG/WebP, transparency, corrupt/empty/oversize/multiple-page/invalid-page input, abort and unchanged originals");
} finally { await app.close(); rmSync(temp, { recursive: true, force: true }); }
