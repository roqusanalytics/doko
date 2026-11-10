import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';import {tmpdir} from 'node:os';import {performance} from 'node:perf_hooks';
import {PDFDocument,StandardFonts} from 'pdf-lib';import {createServer} from 'vite';import {_electron as electron} from 'playwright-core';
import {electronPath} from './electron-path.mjs';import {readerPage} from './reader-page.mjs';import {closeHidden,assertHidden} from './hidden-window.mjs';
const root=path.resolve(import.meta.dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'doko-prod-bench-')),server=await createServer({root,logLevel:'error',server:{host:'127.0.0.1',port:0}});let app;
try{
 await server.listen();const env={...process.env,FOLIO_TEST_USER_DATA:temp,FOLIO_TEST_HIDDEN:'1',FOLIO_DEV_URL:server.resolvedUrls.local[0]};delete env.ELECTRON_RUN_AS_NODE;
 const started=performance.now();app=await electron.launch({executablePath:electronPath(env),env,args:[root,'--mute-audio',...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])]});const window=await app.firstWindow(),page=readerPage(window);
 await page.getByRole('button',{name:/Try a sample/}).waitFor();const readyMs=performance.now()-started;
 const cdp=await window.context().newCDPSession(window);await cdp.send('Performance.enable');const rows=[];
 for(let i=0;i<4;i++){
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let n=0;n<100;n++)pdf.addPage().drawText(`Synthetic document ${i+1} page ${n+1}`,{font,size:18,x:40,y:700});const bytes=[...await pdf.save()];const t=performance.now();
  await page.evaluate(bytes=>window.frameElement.readerContext.tabs.open([{kind:'bytes',name:'Synthetic.pdf',data:new Uint8Array(bytes)}]),bytes);
  await page.locator('.page canvas').first().waitFor();await page.waitForFunction(()=>document.querySelector('.page canvas')?.width>0);
  const metrics=await cdp.send('Performance.getMetrics');const get=n=>metrics.metrics.find(x=>x.name===n)?.value;
  rows.push({tabs:i+1,openMs:Math.round(performance.now()-t),rendererHeapMiB:Math.round(get('JSHeapUsedSize')/1048576),domNodes:get('Nodes')});
 }
 const storedMetadata=await page.evaluate(async()=>{
  const r=await import('/src/recent.ts');const id='benchmark-metadata';
  await r.saveRecent({id,name:'Synthetic metadata benchmark',size:8*1024*1024,pages:100,openedAt:Date.now(),lastPage:1,thumb:'',data:new Blob([new Uint8Array(8*1024*1024)])});
  const started=performance.now();for(let n=2;n<=21;n++)await r.updateLastPage(id,n);
  const elapsed=performance.now()-started;const result=await r.getRecent(id);await r.removeRecent(id);
  return {fixtureMiB:8,updates:20,totalMs:Math.round(elapsed),lastPage:result.lastPage,blobBytes:result.data.size,limit:'IndexedDB completion timings; not physical disk bytes'};
 });
 console.log(JSON.stringify({platform:process.platform,electron:await app.evaluate(()=>process.versions.electron),readyMs:Math.round(readyMs),storedMetadata,fixture:'four distinct synthetic100-page PDFs; Vite development, no forced GC',rows,limits:'heap is a renderer/CDP sample, not OS RSS or production startup benchmark; does not prove blob disk writes'},null,2));await assertHidden(app);
}finally{if(app)await closeHidden(app);await server.close();rmSync(temp,{recursive:true,force:true});}
