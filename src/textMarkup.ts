import { PDFDocument, PDFHexString, PDFString } from "pdf-lib/es";
import { checkPdfSize } from "./pdfInput";

export type TextMarkupStyle = "Underline" | "StrikeOut";
export interface TextMarkupQuad { page: number; points: number[] }

export async function addTextMarkup(bytes: Uint8Array, quads: TextMarkupQuad[], style: TextMarkupStyle, color: string, note = "") {
  checkPdfSize(bytes.byteLength);
  if (!["Underline", "StrikeOut"].includes(style) || !/^#[\da-f]{6}$/i.test(color)) throw new Error("Choose a valid text marking style and color.");
  if (note.length > 10000) throw new Error("Keep the note under 10,000 characters.");
  if (!quads.length || quads.length > 10000) throw new Error("Select some document text first.");
  const pdf = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const rgb = [1,3,5].map(index => parseInt(color.slice(index,index+2),16)/255);
  for (const {page,points} of quads) {
    if (!Number.isInteger(page) || page < 1 || page > pdf.getPageCount() || points.length !== 8 || !points.every(Number.isFinite)) throw new Error("The text selection is no longer valid. Select it again.");
    const xs = points.filter((_,i) => i%2===0), ys = points.filter((_,i) => i%2===1);
    const annotation = pdf.context.obj({ Type:"Annot", Subtype:style, Rect:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],
      QuadPoints:points, C:rgb, F:4, Contents:PDFHexString.fromText(note), NM:PDFString.of(`doko-${crypto.randomUUID()}`) });
    pdf.getPage(page-1).node.addAnnot(pdf.context.register(annotation));
  }
  return pdf.save({ updateFieldAppearances:false });
}
