// Exercise the actual browser decoder and PDF renderer without showing a window.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, degrees } from "pdf-lib";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden } from "./hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "folio-photo-codec-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const asset = readdirSync(path.join(root, "dist/assets")).find(name => /^documentExport-.*\.js$/.test(name));
assert.ok(asset, "Build Folio before running the photo codec test");
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio",
  ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const page = readerPage(await app.firstWindow());
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const result = await page.evaluate(async asset => {
    const { photoPdf, prepareDocumentExport } = await import(new URL(`./assets/${asset}`, location.href).href);
    const photoPng = async (bytes, signal) => (await prepareDocumentExport({ bytes, name: "photo.png", photo: true, page: 1 },
      { format: "png", compress: false, quality: 1, maxEdge: 0 }, signal)).blob;
    const reject = async (operation, pattern) => {
      try { await operation(); } catch (error) {
        if (!pattern.test(String(error))) throw error;
        return;
      }
      throw new Error("Invalid input was accepted");
    };
    await reject(() => photoPdf(new Blob()), /decode|source|image/i);
    await reject(() => photoPdf(new Blob(["not an image"], { type: "image/png" })), /decode|source|image/i);
    await reject(() => photoPdf({ size: 100 * 1024 * 1024 + 1 }), /100 MB/);
    const stopped = new AbortController(); stopped.abort();
    await reject(() => photoPdf(new Blob(), stopped.signal), /abort/i);
    await reject(() => photoPng(new Uint8Array(), stopped.signal), /abort/i);
    const source = document.createElement("canvas"); source.width = 2; source.height = 3;
    source.getContext("2d").fillStyle = "red";
    source.getContext("2d").fillRect(0, 0, 1, 1);
    const png = await new Promise(resolve => source.toBlob(resolve, "image/png"));
    const bytes = await photoPdf(png);
    const copy = await photoPng(bytes, new AbortController().signal);
    const bitmap = await createImageBitmap(copy);
    const output = document.createElement("canvas"); output.width = bitmap.width; output.height = bitmap.height;
    output.getContext("2d").drawImage(bitmap, 0, 0);
    const pixels = [...output.getContext("2d").getImageData(0, 0, 2, 3).data];
    const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
    source.width = source.height = output.width = output.height = 0;
    source.width = 40_000; source.height = 1;
    const wide = await new Promise(resolve => source.toBlob(resolve, "image/png"));
    const wideCopy = await photoPng(await photoPdf(wide), new AbortController().signal);
    const wideBitmap = await createImageBitmap(wideCopy);
    const wideDimensions = [wideBitmap.width, wideBitmap.height]; wideBitmap.close();
    source.width = source.height = 0;
    return { dimensions, pixels, bytes: [...bytes], wideDimensions };
  }, asset);
  assert.deepEqual(result.dimensions, [2, 3]);
  assert.deepEqual(result.wideDimensions, [40_000, 1], "wide photo dimensions changed");
  assert.deepEqual(result.pixels.slice(0, 4), [255, 0, 0, 255], "photo color changed");
  assert.equal(result.pixels.at(-1), 0, "PNG transparency was flattened");

  const pdf = await PDFDocument.load(new Uint8Array(result.bytes));
  pdf.getPage(0).setRotation(degrees(90));
  const rotated = [...await pdf.save()];
  assert.deepEqual(await page.evaluate(async ({ asset, bytes }) => {
    const { prepareDocumentExport } = await import(new URL(`./assets/${asset}`, location.href).href);
    const { blob } = await prepareDocumentExport({ bytes: new Uint8Array(bytes), name: "photo.png", photo: true, page: 1 },
      { format: "png", compress: false, quality: 1, maxEdge: 0 }, new AbortController().signal);
    const bitmap = await createImageBitmap(blob);
    const dimensions = [bitmap.width, bitmap.height]; bitmap.close(); return dimensions;
  }, { asset, bytes: rotated }), [3, 2]);
  const huge = await PDFDocument.create(); huge.addPage([10_000, 8_001]);
  const multiple = await PDFDocument.create(); multiple.addPage(); multiple.addPage();
  for (const [bytes, expected] of [[await huge.save(), "80 million"], [await multiple.save(), "single photo"]]) {
    const error = await page.evaluate(async ({ asset, bytes }) => {
      const { prepareDocumentExport } = await import(new URL(`./assets/${asset}`, location.href).href);
      try {
        await prepareDocumentExport({ bytes: new Uint8Array(bytes), name: "photo.png", photo: true, page: 1 },
          { format: "png", compress: false, quality: 1, maxEdge: 0 }, new AbortController().signal);
        return "accepted";
      }
      catch (error) { return error.message; }
    }, { asset, bytes: [...bytes] });
    assert.ok(error.includes(expected), error);
  }
  await assertHidden(app);
  console.log("PASS photo codec: corrupt/empty/oversized input, abort, original pixels, transparency, rotation, pixel budget and single-page limit");
} finally {
  await app.close(); rmSync(temp, { recursive: true, force: true });
}
