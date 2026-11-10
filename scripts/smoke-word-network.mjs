// Word converters must render embedded images without fetching linked content.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";

const converter = process.env.FOLIO_TEST_CONVERTER ?? "builtin";
assert.ok(["builtin", "libreoffice", "word"].includes(converter), "Choose a supported Word test converter");
const root = path.resolve(import.meta.dirname, ".."), temp = mkdtempSync(path.join(tmpdir(), "doko-word-network-"));
const bootstrap = path.join(temp, "bootstrap.cjs"), requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  response.writeHead(200, { "Content-Type": "image/png" });
  response.end(readFileSync(path.join(temp, "outside.png")));
});
let app;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  writeFileSync(bootstrap, `
    const { app } = require("electron");
    app.setPath("userData", ${JSON.stringify(path.join(temp, "profile"))});
    app.on("window-all-closed", () => {});
    app.whenReady().then(() => app.dock?.hide());
    globalThis.openWord = require(${JSON.stringify(path.join(root, "electron/convert.cjs"))}).openWord;
  `);
  const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1", FOLIO_TEST_CONVERTER: converter };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath(env), env,
    args: [bootstrap, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
  const png = await app.evaluate(({ nativeImage }) => {
    const pixel = bytes => [...nativeImage.createFromBitmap(Buffer.from(bytes), { width: 1, height: 1 }).toPNG()];
    return { embedded: pixel([255, 0, 0, 255]), outside: pixel([0, 0, 255, 255]) };
  });
  const outside = path.join(temp, "outside.png");
  writeFileSync(outside, Buffer.from(png.outside));
  const url = `http://127.0.0.1:${server.address().port}/tracking.png`;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>';
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="embedded" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/embedded.png"/><Relationship Id="remote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${url}" TargetMode="External"/><Relationship Id="outside" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${pathToFileURL(outside).href}" TargetMode="External"/></Relationships>`);
  zip.file("word/media/embedded.png", Buffer.from(png.embedded));
  const image = (id, attribute, index) => `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="${index}" name="${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:${attribute}="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  zip.file("word/document.xml", `${xml}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>Local Word conversion</w:t></w:r></w:p>${image("embedded", "embed", 1)}${image("remote", "link", 2)}${image("outside", "link", 3)}</w:body></w:document>`);
  const source = path.join(temp, "linked-images.docx"), bytes = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(source, bytes);
  const output = await app.evaluate(async (_, source) => {
    const result = await globalThis.openWord(source);
    return { name: result.name, bytes: [...result.data] };
  }, source);
  assert.match(output.name, /\.pdf$/);
  const pdf = await PDFDocument.load(new Uint8Array(output.bytes));
  assert.equal(pdf.getPageCount(), 1);
  const images = pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
  assert.equal(images.length, 1, "Only the embedded image may reach the converted PDF; external file images must be excluded");
  assert.deepEqual([...decodePDFRawStream(images[0][1]).decode()], [0, 0, 255], "The retained image must be the embedded blue RGB pixel, not the external red pixel");
  assert.deepEqual(requests, [], "Opening a local Word document must not fetch linked HTTP images");
  assert.deepEqual(readFileSync(source), bytes, "Conversion must preserve the source document");
  await assertHidden(app);
  console.log(`PASS ${converter} Word conversion: embedded image retained, HTTP and file-linked images excluded, zero network requests, original unchanged, hidden isolated app`);
} finally {
  if (app) await closeHidden(app);
  await new Promise(resolve => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
