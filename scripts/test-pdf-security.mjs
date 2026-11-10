// Exercise the shipped encryption worker and pixel-only redaction helper in a hidden renderer.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFRawStream, PDFHexString, decodePDFRawStream, degrees } from "pdf-lib";
import { init } from "@embedpdf/pdfium";
import UPNG from "@pdf-lib/upng";
import { _electron as electron } from "playwright-core";
import { electronPath } from "./electron-path.mjs";
import { readerPage } from "./reader-page.mjs";
import { assertHidden, closeHidden } from "./hidden-window.mjs";
const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "doko-pdf-security-"));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: "1" }; delete env.ELECTRON_RUN_AS_NODE;
const asset = readdirSync(path.join(root, "dist/assets")).find(name => /^pdfSecurity-.*\.js$/.test(name));
assert.ok(asset, "Build Doko before testing PDF security");
const fixture = await PDFDocument.create(); fixture.setTitle("PRIVATE METADATA"); fixture.setSubject("SECRET SUBJECT");
const image = await fixture.embedPng(UPNG.default.encode([new Uint8Array([255,0,0,255,0,0,255,255,0,255,0,255,255,255,0,255]).buffer],2,2,0));
for (let i = 0; i < 2; i++) { const p = fixture.addPage([200, 140]); p.drawText("SECRET", { x: 15, y: 110, size: 14 }); p.drawImage(image, { x: 20, y: 20, width: 50, height: 40 }); if (i) { p.setCropBox(10, 10, 160, 110); p.setRotation(degrees(90)); } }
fixture.addPage([200, 140]).drawText("KEEP PUBLIC", { x: 15, y: 70, size: 14 });
await fixture.attach(new TextEncoder().encode("PRIVATE ATTACHMENT SECRET"), "private.txt");
const original = [...await fixture.save()];
const huge = await PDFDocument.create(); huge.addPage([10000, 10000]);
const signed = await PDFDocument.create(); signed.addPage();
const signature = signed.context.register(signed.context.obj({Type:"Sig",Filter:"Adobe.PPKLite",SubFilter:"adbe.pkcs7.detached",ByteRange:[0,0,0,0],Contents:PDFHexString.of("00")}));
const signatureField = signed.context.register(signed.context.obj({FT:"Sig",T:"Signature",V:signature}));
signed.catalog.set(PDFName.of("AcroForm"),signed.context.register(signed.context.obj({Fields:[signatureField],SigFlags:3})));
const app = await electron.launch({ executablePath: electronPath(env), env, args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])], timeout: 60_000 });
try {
  const page = readerPage(await app.firstWindow());
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  const result = await page.evaluate(async ({ asset, original, huge, signed }) => {
    const module = await import(new URL(`./assets/${asset}`, location.href).href);
    const { protectPdf, redactPdf, loadRedactionPdf, validatePdfPassword } = module;
    const signal = new AbortController().signal, source = new Uint8Array(original);
    const reject = async (run, pattern) => { try { await run(); } catch (error) { if (!pattern.test(String(error))) throw error; return; } throw new Error("Invalid input accepted"); };
    await reject(() => protectPdf(source, "", signal), /password/);
    await reject(() => validatePdfPassword("secret", "other"), /match/);
    await reject(() => validatePdfPassword("x".repeat(128)), /127/);
    await reject(() => validatePdfPassword("abc\0def"), /null/);
    await reject(() => protectPdf(new Uint8Array(), "test", signal), /empty/);
    await reject(() => protectPdf(new TextEncoder().encode("broken"), "test", signal), /PDF/);
    await reject(() => redactPdf(source, [], signal), /least one/);
    await reject(() => redactPdf(source, [{page:1,x:NaN,y:0,width:1,height:1}], signal), /valid/);
    await reject(() => redactPdf(source, [{page:99,x:0,y:0,width:1,height:1}], signal), /existing/);
    const stop = new AbortController(); stop.abort(); await reject(() => protectPdf(source, "test", stop.signal), /abort/i);
    const protectedBytes = await protectPdf(source, "doko-test-password", signal);
    await reject(() => protectPdf(protectedBytes, "test", signal), /unencrypted/);
    await reject(() => protectPdf(new Uint8Array(signed), "test", signal), /unsigned/);
    await reject(() => loadRedactionPdf(new Uint8Array(signed), signal), /unsigned/);
    const open = await loadRedactionPdf(source, signal);
    const second = await open.getPage(2), view = second.getViewport({scale:1});
    const r = [...view.convertToViewportPoint(10, 10), ...view.convertToViewportPoint(90, 125)];
    const left = Math.max(0, Math.min(r[0], r[2])), top = Math.max(0, Math.min(r[1], r[3]));
    const areas = [{page:1,x:0,y:0,width:0.8,height:1},{page:2,x:left/view.width,y:top/view.height,width:(Math.min(view.width,Math.max(r[0],r[2]))-left)/view.width,height:(Math.min(view.height,Math.max(r[1],r[3]))-top)/view.height}];
    await open.loadingTask.destroy();
    await reject(() => redactPdf(new Uint8Array(huge), [{page:1,x:0,y:0,width:1,height:1}], signal), /too large/);
    const redacted = await redactPdf(source, areas, signal);
    const safe = await loadRedactionPdf(redacted, signal);
    const texts = [], annotations = [], pageSizes = [];
    for (let n=1;n<=safe.numPages;n++) { const p=await safe.getPage(n); texts.push((await p.getTextContent()).items.map(i=>i.str||"").join("")); annotations.push((await p.getAnnotations()).length); const v=p.getViewport({scale:1}); pageSizes.push([v.width,v.height]); }
    const attachments = await safe.getAttachments(); await safe.loadingTask.destroy();
    const encryptedRedacted = await protectPdf(redacted,"doko-test-password",signal);
    return {protectedBytes:[...protectedBytes],redacted:[...redacted],encryptedRedacted:[...encryptedRedacted],unchanged:[...source],texts,annotations,attachments,pageSizes,areas};
  }, { asset, original, huge:[...await huge.save()], signed:[...await signed.save()] });
  assert.deepEqual(result.unchanged, original, "source buffer changed");
  assert.deepEqual(result.texts, ["","",""]);
  assert.deepEqual(result.annotations,[0,0,0]); assert.equal(result.attachments,null);
  assert.deepEqual(result.pageSizes,[[200,140],[110,160],[200,140]]);
  const safe = await PDFDocument.load(new Uint8Array(result.redacted), {updateMetadata:false});
  assert.equal(safe.context.trailerInfo.Info,undefined,"redacted copy contains metadata");
  assert.equal(safe.getTitle(),undefined); assert.equal(safe.getSubject(),undefined);
  const images = [...safe.context.enumerateIndirectObjects()].map(([,object])=>object).filter(object=>object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype"))===PDFName.of("Image"));
  assert.equal(images.length,3,"copy must contain exactly one sanitized raster per page");
  assert.ok(decodePDFRawStream(images[2]).decode().some(channel=>channel<100),"unaffected public page lost its visible text");
  assert.equal([...safe.context.enumerateIndirectObjects()].filter(([,o])=>o.get?.(PDFName.of("Type"))===PDFName.of("Font")).length,0,"source fonts survived");
  for(let n=0;n<2;n++) { const image=images[n], rgb=decodePDFRawStream(image).decode(), width=image.dict.get(PDFName.of("Width")).asNumber(), height=image.dict.get(PDFName.of("Height")).asNumber(), a=result.areas[n]; assert.equal(rgb.length,width*height*3); for(let y=Math.ceil(a.y*height)+2;y<Math.floor((a.y+a.height)*height)-2;y++) for(let x=Math.ceil(a.x*width)+2;x<Math.floor((a.x+a.width)*width)-2;x++) { const i=(y*width+x)*3; assert.equal(rgb[i]+rgb[i+1]+rgb[i+2],0,"recoverable pixels inside redaction"); } }
  const require=createRequire(import.meta.url), m=await init({wasmBinary:readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))});m.PDFiumExt_Init();
  for(const bytes of [result.protectedBytes,result.encryptedRedacted]) { const ptr=m.pdfium.wasmExports.malloc(bytes.length);m.pdfium.HEAPU8.set(bytes,ptr);try { for(const pass of ["","incorrect"]) assert.equal(m.FPDF_LoadMemDocument(ptr,bytes.length,pass),0,"opened without correct password"); const doc=m.FPDF_LoadMemDocument(ptr,bytes.length,"doko-test-password");assert.ok(doc);assert.equal(m.EPDF_IsEncrypted(doc),true);assert.equal(m.FPDF_GetSecurityHandlerRevision(doc),6,"must use AES-256 revision 6");m.FPDF_CloseDocument(doc); } finally {m.pdfium.wasmExports.free(ptr);} }
  await assertHidden(app);
  console.log("PASS PDF security: real AES-256 no/wrong/correct password; immutable original; image pixels destroyed; no text/fonts/annotations/attachments/source metadata; crop+rotation preserved; signed/encrypted/invalid/empty/oversized/abort inputs");
} finally { await closeHidden(app); rmSync(temp,{recursive:true,force:true}); }
