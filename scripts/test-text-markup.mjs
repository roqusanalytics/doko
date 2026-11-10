import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {PDFDocument, PDFName} from 'pdf-lib';
const server=await createServer({server:{middlewareMode:true},appType:'custom',ssr:{noExternal:['pdf-lib']}});
try {
 const {addTextMarkup}=await server.ssrLoadModule('/src/textMarkup.ts');
 const previousWindow = globalThis.window;
 globalThis.window = {};
 let textMarkupQuads;
 try { ({textMarkupQuads} = await server.ssrLoadModule('/src/Selection.tsx')); }
 finally { globalThis.window = previousWindow; }
 const rect = (left, top, right, bottom) => ({left, top, right, bottom, width:right-left, height:bottom-top});
 const first = rect(110,220,130,240), second = rect(510,220,530,240);
 const boxes = [rect(100,200,300,600), rect(500,200,700,600)];
 const viewer = {getPageView(index) { return index < 2 ? {
  div:{querySelector() { return {getBoundingClientRect() { return boxes[index]; }}; }},
  viewport:{convertToPdfPoint(x,y) { return [y,100-x]; }},
 } : undefined; }};
 const range = {getClientRects() { return [first,first,rect(110,220,110,240),rect(999,999,1001,1001),second]; }};
 assert.deepEqual(textMarkupQuads(range,viewer,3), [
  {page:1,points:[20,90,20,70,40,90,40,70]},
  {page:2,points:[20,90,20,70,40,90,40,70]},
 ]);
 assert.deepEqual(textMarkupQuads({getClientRects(){return[];}},viewer,3),[]);

 const pdf=await PDFDocument.create(); pdf.addPage([300,400]); const original=await pdf.save(); const untouched=original.slice();
 const quad={page:1,points:[20,120,150,120,20,100,150,100]};
 for(const style of ['Underline','StrikeOut']) {
  const bytes=await addTextMarkup(original,[quad],style,'#305d40'); const out=await PDFDocument.load(bytes);
  const annot=out.context.lookup(out.getPage(0).node.Annots().get(0));
  assert.equal(annot.get(PDFName.of('Subtype')).toString(),'/'+style);
  assert.equal(annot.lookup(PDFName.of('QuadPoints')).size(),8);
  assert.deepEqual(original,untouched);
 }
 await assert.rejects(addTextMarkup(original,[],'Underline','#305d40'));
 await assert.rejects(addTextMarkup(original,[{...quad,page:2}],'Underline','#305d40'));
 await assert.rejects(addTextMarkup(original,[quad],'Underline','bad'));
 console.log('PASS text markup: true underline/strikeout annotations, rotated multi-page selection quads, empty/duplicate/outside rects, invalid selections, unchanged source');
} finally {await server.close();}
