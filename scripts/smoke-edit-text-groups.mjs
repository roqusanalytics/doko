// Run after build; use fragmented font resources through the real worker and reader UI.
import assert from 'node:assert/strict';
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
const glyphOrigins = async bytes => {
  const m = await engine, pointer = m.pdfium.wasmExports.malloc(bytes.length), out = m.pdfium.wasmExports.malloc(16);
  m.pdfium.HEAPU8.set(bytes,pointer);
  const doc = m.FPDF_LoadMemDocument(pointer,bytes.length,''), sheet = m.FPDF_LoadPage(doc,0), text = m.FPDFText_LoadPage(sheet);
  try {
    const result = [];
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
  for (const fixture of [await fragmentedTextPdf(), await fragmentedTextPdf({variableTracking:true}), await subsetType3Pdf(), await subsetType3Pdf({variableTracking:true})]) {
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
    await app.evaluate(({BrowserWindow}, bytes) => BrowserWindow.getAllWindows()[0].webContents.send('folio:open-file', {name:'Fragmented.pdf',data:Buffer.from(bytes)}), [...fixture.bytes]);
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
