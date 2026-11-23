// Actual worker source + real PDFium; no shared dist build or timing claims.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createServer, transformWithOxc } from 'vite';
import { init } from '@embedpdf/pdfium';
import { PDFDocument, StandardFonts, PDFHexString, PDFString, PDFName } from 'pdf-lib';

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));

const makePdf = async (label) => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setCreationDate(new Date('2026-01-01T00:00:00Z')); pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));

  for (let i = 0; i < 3; i++) pdf.addPage().drawText(`${label} ${i + 1}`, { font, x: 40, y: 100 });

  return pdf.save();
};

const cacheDir = mkdtempSync(path.join(tmpdir(), 'doko-editor-test-cache-'));
const loader = await createServer({ cacheDir, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
let checkPdfSize;

try { ({ checkPdfSize } = await loader.ssrLoadModule('/src/pdfInput.ts')); } finally { await loader.close(); rmSync(cacheDir, { recursive: true, force: true }); }

const source = await makePdf('Original'), snapshot = await makePdf('Snapshot');

async function worker(filename) {
  const m = await init({ wasmBinary: wasm });
  const counts = { copies: 0, bytes: 0, opens: 0, closes: 0, pages: 0, pageCloses: 0 }, allocations = new Set();

  const exports = new Proxy({}, { get(_target, key) {
    const target = m.pdfium.wasmExports;

    if (key === 'malloc') return size => { const ptr = target.malloc(size);

 if (ptr) allocations.add(ptr);

 return ptr; };

    if (key === 'free') return ptr => { assert.ok(allocations.delete(ptr), 'free owned allocation once');

 return target.free(ptr); };

    return target[key];
  } });

  const heap = new Proxy(m.pdfium, { get(target, key) {
    if (key === 'wasmExports') return exports;

    if (key === 'HEAPU8') return new Proxy(target.HEAPU8, { get(array, field) {
      if (field === 'set') return (bytes, ptr) => { counts.copies++; counts.bytes += bytes.length; array.set(bytes, ptr); };

      return typeof array[field] === 'function' ? array[field].bind(array) : array[field];
    } });

    return target[key];
  } });

  const names = { FPDF_LoadMemDocument: 'opens', FPDF_CloseDocument: 'closes', FPDF_LoadPage: 'pages', FPDF_ClosePage: 'pageCloses' };

  const wrapped = new Proxy(m, { get(target, key) {
    if (key === 'pdfium') return heap;

    if (names[key]) return (...args) => { counts[names[key]]++;

 return target[key](...args); };

    return target[key];
  } });

  const replies = [];
  const self = { postMessage: reply => replies.push(reply), close() { self.closed = true; } };
  // Exercise Windows checkout line endings on every platform.
  const code = readFileSync(filename, 'utf8').replace(/\r?\n/g, '\r\n').replace(/^import .*;\r?\n/gm, '');
  assert.doesNotMatch(code, /^import\b/m, 'the VM fixture must strip imports with CRLF or LF');
  const js = (await transformWithOxc(code.replace(/^export /gm, ''), filename, { lang: 'ts', target: 'es2022' })).code;

  const context = vm.createContext({ self, Uint8Array, Error, Map, Set, fetch: async () => ({ ok: true, arrayBuffer: async () => wasm }),
    wasmUrl: 'test', init: async () => wrapped,
    checkPdfSize,
    replacePageImage() { throw new Error('Image replacement outside this text/session test'); } });

  vm.runInContext(js, context);

  const send = async data => {
    self.onmessage({ data });

    // Await the production queue (baseline has an async handler instead).
    if (code.includes('let pending =')) await vm.runInContext('pending', context);
    else { await new Promise(resolve => setImmediate(resolve)); }

    return replies.shift();
  };

  return { send, counts, allocations, self };
}

const actual = await worker('src/contentEditor.worker.ts');

await actual.send({ source });

for (const page of [1, 2, 3, 1]) {
  const result = await actual.send({ page });
  assert.ok(result.targets, JSON.stringify(result));
  assert.equal(result.targets[0].label, `Original ${page}`);
}

assert.deepEqual(actual.counts, { copies: 1, bytes: source.length, opens: 1, closes: 0, pages: 4, pageCloses: 4 });

assert.equal(actual.allocations.size, 1, 'only retained document buffer survives inspection');

console.log('A4 after: 4 inspections,', actual.counts);

if (process.env.DOKO_EDITOR_BASELINE) {
  const baseline = await worker(process.env.DOKO_EDITOR_BASELINE);
  await baseline.send({ source });

  for (const page of [1, 2, 3, 1]) assert.equal((await baseline.send({ page })).targets[0].label, `Original ${page}`);
  assert.equal(baseline.counts.opens, 4); assert.equal(baseline.counts.copies, 4);
  assert.equal(baseline.allocations.size, 0);
  console.log('A4 before: same 4 inspections,', baseline.counts);
}

for (let trial = 1; trial < 5; trial++) {
  for (const [filename, copies] of [['src/contentEditor.worker.ts', 1],
    ...(process.env.DOKO_EDITOR_BASELINE ? [[process.env.DOKO_EDITOR_BASELINE, 4]] : [])]) {
    const sample = await worker(filename);
    await sample.send({ source });

    for (const page of [1, 2, 3, 1]) assert.equal((await sample.send({ page })).targets[0].label, `Original ${page}`);
    assert.equal(sample.counts.copies, copies); assert.equal(sample.counts.opens, copies);
    assert.equal(sample.counts.bytes, copies * source.length);

    if (copies === 1) await sample.send({ dispose: true });
    assert.equal(sample.allocations.size, 0);
  }
}

console.log('A4 counters: 5 trials per side when baseline supplied; copy/open count spread = 0');

assert.match((await actual.send({ page: 99 })).error, /open this page/);

assert.equal(actual.allocations.size, 1);

for (const text of ['bad\nline', 'x'.repeat(32768)]) {
  assert.match((await actual.send({ page: 1, snapshot, change: { kind: 'text', index: 0, text } })).error, /single line/);
  assert.equal(actual.allocations.size, 1, 'failed edits free snapshot');
}

for (const text of ['Edited', '']) {
  const result = await actual.send({ page: 1, snapshot, change: { kind: 'text', index: 0, text } });
  assert.ok(result.bytes, result.error);
  assert.equal(actual.allocations.size, 1);
  assert.equal((await actual.send({ page: 1 })).targets[0].label, 'Original 1', 'edit never mutates inspection');
  const verify = await worker('src/contentEditor.worker.ts');
  await verify.send({ source: result.bytes });
  const targets = (await verify.send({ page: 1 })).targets;
  assert.equal(targets.length, text ? 1 : 0);

 if (text) assert.equal(targets[0].label, text);
  await verify.send({ dispose: true }); assert.equal(verify.allocations.size, 0);
}

await actual.send({ source: snapshot });

assert.equal(actual.allocations.size, 0, 'replacement releases old document and buffer');

assert.equal((await actual.send({ page: 1 })).targets[0].label, 'Snapshot 1');

await actual.send({ source: new Uint8Array([1, 2, 3]) });

assert.match((await actual.send({ page: 1 })).error, /open this PDF/);

assert.equal(actual.allocations.size, 0, 'failed document load frees buffer');

await actual.send({ source });

assert.equal((await actual.send({ page: 1 })).targets[0].label, 'Original 1');

await actual.send({ dispose: true });

assert.equal(actual.allocations.size, 0);

 assert.equal(actual.self.closed, true);

assert.equal(actual.counts.pages, actual.counts.pageCloses + 1, 'only invalid page had no handle to close');

// Requests queued before initialization keep their source association.
const queued = await worker('src/contentEditor.worker.ts');
const requests = [queued.send({ source }), queued.send({ page: 1 }), queued.send({ source: snapshot }), queued.send({ page: 2 })];
const replies = await Promise.all(requests);

assert.deepEqual(replies.filter(Boolean).map(reply => reply.targets[0].label), ['Original 1', 'Snapshot 2']);

await queued.send({ dispose: true });

 assert.equal(queued.allocations.size, 0);

console.log('PASS session cleanup, failed load/page/edit, source replacement, independent edits/empty text and queued requests');

// A syntactic signature is enough for PDFium to forbid editing; no real identity is used.
const signed = await PDFDocument.load(source), ctx = signed.context;

const signature = ctx.register(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
  Contents: PDFHexString.of('00'), ByteRange: [0, 0, 0, 0] }));

const field = ctx.register(ctx.obj({ FT: 'Sig', T: PDFString.of('Test'), V: signature }));

signed.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field] }));

const safety = await worker('src/contentEditor.worker.ts');

await safety.send({ source: await signed.save() });

assert.match((await safety.send({ page: 1 })).error, /unsigned, unencrypted/);

assert.equal(safety.allocations.size, 0, 'signature rejection closes document and buffer');

await safety.send({ dispose: true });

console.log('PASS real signed-document rejection and cleanup');

const protection = await init({ wasmBinary: wasm });

 protection.PDFiumExt_Init();

const ptr = protection.pdfium.wasmExports.malloc(source.length);
let encryptedDoc = 0, writer = 0, output = 0, encrypted;

try {
  protection.pdfium.HEAPU8.set(source, ptr);
  encryptedDoc = protection.FPDF_LoadMemDocument(ptr, source.length, '');
  assert.ok(protection.EPDF_SetEncryption(encryptedDoc, '', 'test-owner', -4));
  writer = protection.PDFiumExt_OpenFileWriter();
  assert.ok(protection.FPDF_SaveAsCopy(encryptedDoc, writer, 2));
  const size = protection.PDFiumExt_GetFileWriterSize(writer);
  output = protection.pdfium.wasmExports.malloc(size);
  assert.equal(protection.PDFiumExt_GetFileWriterData(writer, output, size), size);
  encrypted = protection.pdfium.HEAPU8.slice(output, output + size);
} finally {
  if (output) protection.pdfium.wasmExports.free(output);

  if (writer) protection.PDFiumExt_CloseFileWriter(writer);

  if (encryptedDoc) protection.FPDF_CloseDocument(encryptedDoc);
  protection.pdfium.wasmExports.free(ptr);
}

const protectedWorker = await worker('src/contentEditor.worker.ts');

await protectedWorker.send({ source: encrypted });

assert.match((await protectedWorker.send({ page: 1 })).error, /unsigned, unencrypted/);

assert.equal(protectedWorker.allocations.size, 0);

await protectedWorker.send({ dispose: true });

console.log('PASS real encrypted-document rejection and cleanup');
