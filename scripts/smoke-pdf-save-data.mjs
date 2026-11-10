// Native PDF saves and reopened content hashes, using synthetic data and no provider requests.
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';
import {_electron as electron} from 'playwright-core';
import {electronPath} from './electron-path.mjs';
import {readerPage} from './reader-page.mjs';
import {assertHidden,closeHidden} from './hidden-window.mjs';
const root=path.resolve(import.meta.dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'doko-pdf-save-data-'));
const contentKey=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}:${bytes.length}`;
const fixture=await PDFDocument.create();
fixture.addPage([400,400]).drawText('SYNTHETIC FIRST PAGE TEXT',{x:30,y:320,size:15});
fixture.addPage([400,400]).drawText('SYNTHETIC SECOND PAGE TEXT',{x:30,y:320,size:15});
const bytes=await fixture.save(),input=path.join(temp,'source.pdf'),output=path.join(temp,'saved.pdf'),reordered=path.join(temp,'reordered.pdf');writeFileSync(input,bytes);
let app;
try {
 const env={...process.env,FOLIO_TEST_USER_DATA:path.join(temp,'profile'),FOLIO_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:electronPath(env),env,args:[root,'--mute-audio',...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])]});
 const window=await app.firstWindow(),page=readerPage(window),errors=[];window.on('pageerror',error=>errors.push(String(error)));
 await page.getByRole('button',{name:/Try a sample/}).waitFor();
 await app.evaluate(({dialog,ipcMain})=>{
  globalThis.pdfSaves=[];globalThis.pdfSaveCount=0;
  dialog.showSaveDialog=async()=>{globalThis.pdfSaveCount++;const filePath=globalThis.pdfSaves.shift();return {canceled:!filePath,filePath:filePath||undefined};};
  ipcMain.removeHandler('folio:ai-status');ipcMain.handle('folio:ai-status',()=>({chatgpt:{connected:false,welcomeSeen:true},claude:{installed:true,loggedIn:true,subscription:true}}));
 });
 const sourceId=contentKey(bytes);
 await page.evaluate(async id=>{
  localStorage.setItem('folio:ai-provider','claude');
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('folio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(['notes','ai'],'readwrite');
   tx.objectStore('notes').put({id,note:'SYNTHETIC LOCAL NOTE',bookmarkedPages:[2],marks:[],updatedAt:Date.now()});
   tx.objectStore('ai').put({id,messages:[{role:'user',content:'SYNTHETIC SAVED CHAT'}],updatedAt:Date.now()});
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
 },sourceId);
 const stored=async id=>page.evaluate(async id=>{
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('folio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(['notes','ai']);const notes=tx.objectStore('notes').get(id),ai=tx.objectStore('ai').get(id);
   tx.oncomplete=()=>resolve({note:notes.result?.note,bookmarks:notes.result?.bookmarkedPages,marks:notes.result?.marks.length,chat:ai.result?.messages[0]?.content});tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
 },id);
 const open=async file=>{await app.evaluate(({app},file)=>app.emit('open-file',{preventDefault(){}},file),file);await page.window.waitForFunction(name=>document.title===name+' — Doko',path.basename(file));await page.waitForFunction(()=>document.querySelector('.textLayer')?.textContent.includes('SYNTHETIC'));};
 await open(input);
 const sidebar=page.getByRole('button',{name:/Toggle sidebar/});if(await sidebar.getAttribute('aria-pressed')==='false')await sidebar.click();
 await page.getByRole('tab',{name:/^Notes/}).click();
 const note=()=>page.getByRole('textbox',{name:'Notes about this document'});assert.equal(await note().inputValue(),'SYNTHETIC LOCAL NOTE');
 await page.evaluate(()=>{
  const span=[...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(span=>span.textContent.includes('SYNTHETIC FIRST'));
  const range=document.createRange();range.selectNodeContents(span);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 });
 await page.getByRole('dialog',{name:'Selected text',exact:true}).waitFor();await page.getByRole('button',{name:'Highlight yellow',exact:true}).click();await page.locator('.highlightEditor').first().waitFor();
 const save=async (target,action=()=>page.keyboard.press('ControlOrMeta+s'))=>{
  const before=await app.evaluate(()=>globalThis.pdfSaveCount);await app.evaluate((_,target)=>globalThis.pdfSaves.push(target),target);
  await action();
  for(let tries=0;await app.evaluate(()=>globalThis.pdfSaveCount)===before;tries++){assert.ok(tries<100,'native Save dialog did not open');await new Promise(resolve=>setTimeout(resolve,100));}
  await page.waitForFunction(()=>!document.querySelector('.topbar-center[inert]'));
  for(let tries=0;target&&!existsSync(target);tries++){assert.ok(tries<100,'native export did not reach disk');await new Promise(resolve=>setTimeout(resolve,50));}
 };
 await save(null);assert.equal(await note().inputValue(),'SYNTHETIC LOCAL NOTE');
 assert.equal(await page.window.locator('iframe.document-reader').count(),1,'cancelled save changed active document');
 await save(output);
 const savedBytes=new Uint8Array(readFileSync(output));const saved=await PDFDocument.load(savedBytes);assert.equal(saved.getPages()[0].node.Annots().size(),1,'native PDF lost or duplicated the highlight');
 const savedId=contentKey(savedBytes);
 assert.notEqual(savedId,sourceId,'save fixture did not change content hash');
 assert.deepEqual(await stored(savedId),{note:'SYNTHETIC LOCAL NOTE',bookmarks:[2],marks:0,chat:'SYNTHETIC SAVED CHAT'});
 const notesOutput=path.join(temp,'notes.json');
 await save(notesOutput,async()=>{await page.getByRole('button',{name:'Export',exact:true}).click();await page.getByRole('menuitem',{name:'Save JSON…',exact:true}).click();});
 assert.equal(JSON.parse(readFileSync(notesOutput,'utf8')).documentNote,'SYNTHETIC LOCAL NOTE');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Version history',exact:true}).click();
 const versionOutput=path.join(temp,'version.pdf');await page.getByRole('button',{name:'Download version 2',exact:true}).waitFor();
 await save(versionOutput,()=>page.getByRole('button',{name:'Download version 2',exact:true}).click());assert.deepEqual(readFileSync(versionOutput),Buffer.from(savedBytes));
 await page.getByRole('button',{name:'Close version history',exact:true}).click();
 await page.getByRole('tab',{name:'Pages',exact:true}).click();await page.getByRole('button',{name:'Page 1',exact:true}).click({button:'right'});
 const pageOutput=path.join(temp,'selected-page.pdf');await save(pageOutput,()=>page.getByRole('menuitem',{name:'Export this page…',exact:true}).click());assert.equal((await PDFDocument.load(readFileSync(pageOutput))).getPageCount(),1);
 await open(output);await page.getByRole('tab',{name:/^Notes/}).click();assert.equal(await note().inputValue(),'SYNTHETIC LOCAL NOTE');
 await page.getByRole('button',{name:'Ask AI',exact:true}).click();await page.getByText('SYNTHETIC SAVED CHAT',{exact:true}).waitFor();await page.getByRole('button',{name:'Close Ask AI',exact:true}).click();
 await page.getByRole('tab',{name:'Pages',exact:true}).click();await page.getByRole('button',{name:'Reorder pages',exact:true}).click();await page.getByLabel('Move page 1 to').fill('2');await page.getByRole('button',{name:'Move',exact:true}).click();
 await save(reordered);
 const reorderedBytes=new Uint8Array(readFileSync(reordered)),reorderedPdf=await PDFDocument.load(reorderedBytes);
 assert.equal(reorderedPdf.getPages().reduce((n,page)=>n+(page.node.Annots()?.size()??0),0),1,'reopened save duplicated embedded annotations');
 await open(reordered);await page.getByRole('tab',{name:/^Notes/}).click();assert.equal(await note().inputValue(),'SYNTHETIC LOCAL NOTE');
 await page.getByRole('tab',{name:'Pages',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Bookmark page 1',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Ask AI',exact:true}).click();await page.getByText('SYNTHETIC SAVED CHAT',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close Ask AI',exact:true}).click();
 await page.evaluate(()=>{
  const span=[...document.querySelectorAll('.textLayer span')].find(span=>span.textContent.includes('SYNTHETIC'));
  const range=document.createRange();range.selectNodeContents(span);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
 });
 await page.getByRole('dialog',{name:'Selected text',exact:true}).waitFor();await page.getByRole('button',{name:'Text marking style',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'Underline',exact:true}).click();await page.getByRole('button',{name:'Highlight yellow',exact:true}).click();
 await page.getByRole('button',{name:'Save copy',exact:true}).waitFor();await save(null);await page.getByRole('button',{name:'Save copy',exact:true}).waitFor();
 const edited=path.join(temp,'edited.pdf');await save(edited);await page.getByRole('button',{name:'Save copy',exact:true}).waitFor({state:'detached'});
 await page.getByRole('tab',{name:/^Notes/}).click();assert.equal(await note().inputValue(),'SYNTHETIC LOCAL NOTE');
 await page.getByRole('button',{name:'Ask AI',exact:true}).click();await page.getByText('SYNTHETIC SAVED CHAT',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);await assertHidden(app);
 console.log('PASS native PDF save data: cancelled save retains source; changed content hash reopens with local note/bookmarks/chat; reordered bookmark maps to new page; repeated native save retains exactly one embedded highlight; native notes JSON/version/selected-page exports; sourceId underline copy cancels safely then reattaches reading and chat; no provider request');
}finally{if(app)await closeHidden(app);rmSync(temp,{recursive:true,force:true});}
