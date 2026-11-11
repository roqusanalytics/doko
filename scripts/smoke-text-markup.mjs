import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PDFDocument,PDFName} from 'pdf-lib';
import {_electron as electron} from 'playwright-core';
import {electronPath} from './electron-path.mjs';
import {readerPage} from './reader-page.mjs';
import {captureSave} from './capture-save.mjs';
import {assertHidden,closeHidden} from './hidden-window.mjs';
const root=path.resolve(import.meta.dirname,'..'), temp=mkdtempSync(path.join(tmpdir(),'doko-text-markup-'));
const env={...process.env,FOLIO_TEST_USER_DATA:temp,FOLIO_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:electronPath(env),args:[root,'--mute-audio',...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])],env});
try {
 const window=await app.firstWindow(),page=readerPage(window);
 await page.getByRole('button',{name:/Try a sample/}).click();
 const select=async()=>{
  await page.locator('.textLayer span:not(.markedContent)').first().waitFor();
  await page.evaluate(()=>{
   const span=[...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(span=>span.textContent.length>15);
   const range=document.createRange();range.selectNodeContents(span);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
   document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('dialog',{name:'Selected text',exact:true}).waitFor();
 };
 await page.getByRole('button',{name:'Reorder pages',exact:true}).click();
 await page.getByLabel('Move page 1 to').fill('4'); await page.getByRole('button',{name:'Move',exact:true}).click();
 for(const style of ['Underline','Strike through']) {
  await select();await page.getByRole('button',{name:'Text marking style',exact:true}).click();
  await page.getByRole('menuitemradio',{name:style,exact:true}).click();
  await page.getByRole('button',{name:'Highlight yellow',exact:true}).click();
  await page.getByRole('button',{name:'Undo document edit',exact:true}).waitFor();
  await page.getByRole('dialog',{name:'Selected text',exact:true}).waitFor({state:'hidden'});
  if(style==='Underline') {
   await page.getByRole('button',{name:'Undo document edit',exact:true}).click();
   await page.getByRole('button',{name:'Undo document edit',exact:true}).waitFor({state:'hidden'});
  }
 }
 const file=path.join(temp,'marked.pdf');await captureSave(app,file,'markedSaved');
 await page.keyboard.press('ControlOrMeta+s');assert.equal(await app.evaluate(()=>globalThis.markedSaved),'completed');
 const pdf=await PDFDocument.load(readFileSync(file));const annotations=pdf.getPages().flatMap(page=>page.node.Annots()?.asArray().map(ref=>pdf.context.lookup(ref).get(PDFName.of('Subtype')).toString())??[]);
 assert.ok(annotations.includes('/StrikeOut'),'actual saved PDF has true strikeout annotation');
 assert.ok(!annotations.includes('/Underline'),'Undo removed prior underline');
 const text = await page.evaluate(async bytes=>{const pdf=await pdfjsLib.getDocument({data:Uint8Array.from(bytes)}).promise;try{return (await (await pdf.getPage(4)).getTextContent()).items.map(item=>item.str??'').join(' ');}finally{await pdf.loadingTask.destroy();}},[...readFileSync(file)]);
 assert.ok(text.includes('A short tour of Doko'),'pending page reorder survives marking and Undo');
 const input=path.join(temp,'undo-content.pdf'),fixture=await PDFDocument.create();
 fixture.addPage([300,400]).drawText('ORIGINAL SAMPLE TEXT',{x:30,y:300,size:15});writeFileSync(input,await fixture.save());
 await app.evaluate(({app},file)=>app.emit('open-file',{preventDefault(){}},file),input);
 await page.locator('.textLayer').filter({hasText:'ORIGINAL SAMPLE TEXT'}).waitFor();
 await select();await page.getByRole('button',{name:'Text marking style',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'Underline',exact:true}).click();await page.getByRole('button',{name:'Highlight yellow',exact:true}).click();
 const undo=page.getByRole('button',{name:'Undo document edit',exact:true});await undo.waitFor();assert.ok(await undo.isEnabled());
 await page.getByRole('button',{name:'Edit mode',exact:true}).click();assert.ok(await undo.isDisabled());
 await page.getByRole('button',{name:'ORIGINAL SAMPLE TEXT',exact:true}).click();
 await page.getByRole('textbox',{name:'Edit text on page',exact:true}).fill('UNSAVED REPLACEMENT');assert.ok(await undo.isDisabled());
 await page.getByRole('button',{name:'Exit edit mode',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.textLayer')?.textContent.includes('UNSAVED REPLACEMENT'));
 assert.equal(await undo.count(),0);assert.deepEqual(await page.getByRole('alert').allTextContents(),[]);
 await assertHidden(app);console.log('PASS text markup UI: selected text, underline, Undo, strikeout, save/reopen annotation semantics, pending reorder and newer-content loss prevention');
}finally{await closeHidden(app);rmSync(temp,{recursive:true,force:true});}
