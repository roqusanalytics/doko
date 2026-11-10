import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {PDFDocument, PDFName} from 'pdf-lib';
const server=await createServer({server:{middlewareMode:true},appType:'custom',ssr:{noExternal:['pdf-lib']}});
try {
 const {addTextMarkup}=await server.ssrLoadModule('/src/textMarkup.ts');
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
 console.log('PASS text markup: true underline/strikeout annotations, quads, invalid selections, unchanged source');
} finally {await server.close();}
