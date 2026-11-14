// Run after build; use fragmented font resources through the real worker and reader UI.
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';
import { electronPath } from './electron-path.mjs';
import { readerPage } from './reader-page.mjs';
import { assertHidden, closeHidden } from './hidden-window.mjs';
import { fragmentedTextPdf } from './fixtures/fragmented-text.mjs';
import { subsetType3Pdf } from './fixtures/subset-type3.mjs';
const root = path.resolve(import.meta.dirname, '..'), temp = mkdtempSync(path.join(tmpdir(), 'doko-edit-groups-'));
const env = { ...process.env, FOLIO_TEST_USER_DATA: temp, FOLIO_TEST_HIDDEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url);
const engine = init({wasmBinary:readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'))}).then(m => { m.PDFiumExt_Init(); return m; });
const glyphOrigins = async (bytes, tagged = false) => {
  const m = await engine, pointer = m.pdfium.wasmExports.malloc(bytes.length), out = m.pdfium.wasmExports.malloc(16);
  m.pdfium.HEAPU8.set(bytes,pointer);
  const doc = m.FPDF_LoadMemDocument(pointer,bytes.length,''), sheet = m.FPDF_LoadPage(doc,0), text = m.FPDFText_LoadPage(sheet);
  try {
    const result = [];
    if (tagged) for (let i = 0; i < m.FPDFPage_CountObjects(sheet); i++) {
      const obj = m.FPDFPage_GetObject(sheet,i);
      if (m.FPDFPageObj_GetType(obj) === 1) assert.ok(m.FPDFPageObj_CountMarks(obj) > 0, 'tagged title retains document marks');
    }

    for (let index = 0; index < m.FPDFText_CountChars(text); index++) {
      if (m.FPDFText_IsGenerated(text,index)) continue;
      assert.ok(m.FPDFText_GetCharOrigin(text,index,out,out+8));
      result.push(m.pdfium.HEAPF64[out/8]);
    }
    return result;
  } finally { m.FPDFText_ClosePage(text); m.FPDF_ClosePage(sheet); m.FPDF_CloseDocument(doc); m.pdfium.wasmExports.free(pointer); m.pdfium.wasmExports.free(out); }
};
const sameOrigins = (actual, expected, label) => {
  assert.equal(actual.length,expected.length, `${label}: glyph count`);
  actual.forEach((x,index) => assert.ok(Math.abs(x-expected[index]) < .001, `${label}: glyph ${index} moved from ${expected[index]} to ${x}`));
};
const app = await electron.launch({ executablePath: electronPath(env), args: [root, '--mute-audio', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])], env });
try {
  const window = await app.firstWindow(), page = readerPage(window);
  await page.getByRole('button', { name:/Try a sample/ }).waitFor();
  const worker = readdirSync(path.join(root,'dist/assets')).find(name => /^contentEditor\.worker-[\w-]+\.js$/.test(name));
  const request = (bytes, change) => page.evaluate(async ({worker, bytes, change}) => {
    const w = new Worker(new URL(`assets/${worker}`, location.href), {type:'module'});
    try {
      const source = Uint8Array.from(bytes);
      w.postMessage({source});
      const reply = new Promise((resolve,reject) => { w.onmessage = event => resolve(event.data); w.onerror = event => reject(new Error(event.message)); });
      w.postMessage(change ? {page:1,change,snapshot:source} : {page:1});
      return await reply;
    } finally { w.terminate(); }
  }, {worker,bytes:[...bytes],change});
  const heading = 'A clear start for a coastal creative studio';
  const font = readFileSync(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/LiberationSans-Bold.ttf')).toString('base64');
  const printed = await app.evaluate(async ({BrowserWindow}, {heading,font}) => {
    const win = new BrowserWindow({show:false, webPreferences:{offscreen:true}});
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>@font-face{font-family:Regression;src:url(data:font/ttf;base64,${font});font-weight:700}h1{font-family:Regression}</style><h1>${heading}</h1>`));
    await win.webContents.executeJavaScript('document.fonts.ready');
    return [...await win.webContents.printToPDF({generateTaggedPDF:true})];
  }, {heading,font});
  for (const effect of ['clip', 'blend', 'tags']) {
    const pdf = await PDFDocument.load(Uint8Array.from(printed)), node = pdf.getPage(0).node, context = pdf.context;
    const contents = node.get(PDFName.of('Contents'));
    const prefix = effect === 'clip' ? 'q 0 0 1 1 re W n' : effect === 'tags' ? '/Span << /Lang (en) >> BDC' : 'q /TestBlend gs';
    if (effect === 'blend') node.Resources().set(PDFName.of('ExtGState'), context.obj({TestBlend:{BM:'Multiply',ca:1,CA:1}}));
    node.set(PDFName.of('Contents'), context.obj([context.register(context.stream(prefix)),
      ...(contents instanceof PDFArray ? contents.asArray() : [contents]), context.register(context.stream(effect === 'tags' ? 'EMC' : 'Q'))]));
    const bytes = await pdf.save(), original = await request(bytes), target = original.targets.find(t => t.label === heading);
    assert.ok(target, `${effect}: fixture title is editable`);
    const rejected = await request(bytes, {kind:'text',index:target.index,text:heading + 'k'});
    assert.match(rejected.error, /can't be preserved/, `${effect}: refuse to discard object state`);
    assert.equal(rejected.bytes, undefined);
  }
  for (const fixture of [{bytes:Uint8Array.from(printed), heading, subset:true, replacement:heading.replace('creative','creativekkkk')}, await fragmentedTextPdf(), await fragmentedTextPdf({variableTracking:true}), await subsetType3Pdf(), await subsetType3Pdf({variableTracking:true})]) {
    const original = await request(fixture.bytes);
    assert.ok(!original.error, original.error);
    const target = original.targets.find(target => target.label === fixture.heading);
    assert.ok(target, `whole heading must be one editable target: ${fixture.heading}; got ${original.targets.map(t => t.label).join('|')}`);
    for (const boundary of fixture.boundaries ?? []) assert.ok(original.targets.some(target => target.label === boundary), `boundary retained: ${boundary}`);
    const unchanged = await request(fixture.bytes, {kind:'text',index:target.index,text:fixture.heading});
    assert.ok(!unchanged.error, unchanged.error);
    if (fixture.origins) {
      sameOrigins(await glyphOrigins(fixture.bytes),fixture.origins,'source origins');
      sameOrigins(await glyphOrigins(unchanged.bytes),fixture.origins,'unchanged origins');
    }
    const unchangedTargets = await request(unchanged.bytes);
    assert.ok(unchangedTargets.targets.some(t => t.label === fixture.heading), 'unchanged grouped text round trips without dropping glyphs');
    const unsupported = await request(fixture.bytes, {kind:'text',index:target.index,text:'𐍈'});
    assert.match(unsupported.error, /can't display|Couldn't change/, 'unsupported glyph fails without producing changed bytes');
    assert.equal(unsupported.bytes, undefined);
    if (fixture.subset) {
      for (const text of ['bad\nline', 'x'.repeat(32768)]) {
        const invalid = await request(fixture.bytes, {kind:'text',index:target.index,text});
        assert.match(invalid.error, /single line/); assert.equal(invalid.bytes, undefined);
      }
      const cleared = await request(fixture.bytes, {kind:'text',index:target.index,text:''});
      assert.ok(!cleared.error, cleared.error);
      assert.equal((await request(cleared.bytes)).targets.length, 0, 'empty edit deletes selected text');
    }
    const replacement = fixture.replacement ?? 'Rami aiški eilute.';
    const changed = await request(fixture.bytes, {kind:'text',index:target.index,text:replacement});
    assert.ok(!changed.error, changed.error);
    if (fixture.origins) {
      sameOrigins(await glyphOrigins(changed.bytes),fixture.origins,'replacement origins');
      const editedEnd = await request(fixture.bytes,{kind:'text',index:target.index,text:fixture.prefixReplacement ?? 'ABAA'});
      assert.ok(!editedEnd.error,editedEnd.error);
      sameOrigins(await glyphOrigins(editedEnd.bytes),fixture.origins,'unchanged prefix origins after last-character edit');
    }
    const reopened = await request(changed.bytes);
    assert.ok(reopened.targets.some(target => target.label === replacement), `saved replacement retains full text: ${replacement}`);
    for (const boundary of fixture.boundaries ?? []) assert.ok(reopened.targets.some(target => target.label === boundary), `saved boundary retained: ${boundary}`);
    if (fixture.subset) {
      const before = await glyphOrigins(fixture.bytes), after = await glyphOrigins(changed.bytes, true);
      const prefix = heading.indexOf(' studio');
      sameOrigins(after.slice(0,prefix), before.slice(0,prefix), 'retained title prefix');
      const saved = reopened.targets.find(t => t.label === replacement);
      assert.equal(saved.style.bold, true, 'title remains bold');
      assert.equal(saved.style.size, target.style.size);
      assert.equal(saved.style.color, target.style.color);
      const again = await request(changed.bytes, {kind:'text',index:saved.index,text:replacement.replace('kkkk','kkkkk')});
      assert.ok(!again.error, again.error);
      assert.ok((await request(again.bytes)).targets.some(t => t.label === replacement.replace('kkkk','kkkkk')), 'saved title can be edited again as one line');
    }
    await app.evaluate(({BrowserWindow}, bytes) => BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().startsWith('data:')).webContents.send('folio:open-file', {name:'Fragmented.pdf',data:Buffer.from(bytes)}), [...fixture.bytes]);
    await page.waitForFunction(heading => document.querySelector('.textLayer')?.textContent.includes(heading),fixture.heading);
    await page.getByRole('button', {name:'Edit mode',exact:true}).click();
    const button = page.getByRole('button', {name:fixture.heading,exact:true});
    await button.click();
    const input = page.getByRole('textbox', {name:'Edit text on page',exact:true});
    assert.equal(await input.inputValue(), fixture.heading);
    assert.deepEqual(await input.evaluate(element => [element.selectionStart,element.selectionEnd]), [0,fixture.heading.length], 'click selects the full editable line');
    await input.fill(replacement); await input.press('Enter');
    await page.getByRole('button', {name:replacement,exact:true}).waitFor();
    await page.getByRole('button', {name:'Exit edit mode',exact:true}).click();
    const text = await page.evaluate(async () => {
      const viewer = document.querySelector('.viewer-container');
      return document.querySelector('.textLayer').textContent;
    });
    if (fixture.subset) await window.screenshot({path:path.join(tmpdir(),'doko-title-edit-fixed.png')});
    assert.ok(text.includes(replacement), 'applied edit renders the whole replacement');
    await page.getByRole('button', {name:'Back to library',exact:true}).click();
    // Do not discard the edited fixture: a fresh disposable tab isolates the next input.
    await page.keyboard.press('Escape');
    console.log(`PASS grouped edit: ${fixture.heading} -> ${replacement}; boundaries, unsupported glyph, worker save/reopen and UI selection`);
  }
  await assertHidden(app);
} catch (error) {
  await (await app.firstWindow()).screenshot({path:path.join(tmpdir(),'doko-edit-groups-failure.png')}).catch(()=>{});
  throw error;
} finally {
  await closeHidden(app); rmSync(temp,{recursive:true,force:true}); }
