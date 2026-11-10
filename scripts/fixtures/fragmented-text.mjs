import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Distinct PDF font objects from one family reproduce per-glyph subset fragmentation.
export async function fragmentedTextPdf({ variableTracking = false } = {}) {
  const pdf = await PDFDocument.create();
  const fonts = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold), pdf.embedFont(StandardFonts.TimesRoman),
  ]);
  if (fonts[0].ref.toString() === fonts[1].ref.toString()) throw new Error('Fixture needs distinct font resources');
  const page = pdf.addPage([612, 792]);
  const heading = variableTracking ? 'AVAVA' : 'Geometrinis aiškumas.';
  const origins = [];
  let x = 40;
  [...heading].forEach((letter, index) => {
    const font = fonts[index % 2];
    origins.push(x);
    page.drawText(letter, { x, y: 700, size: 24, font });
    x += font.widthOfTextAtSize(letter, 24) + (variableTracking ? index === 0 ? 1 : -1 : 0);
  });
  if (variableTracking) return { bytes: await pdf.save(), heading, origins, replacement: 'VAVAV', prefixReplacement: 'AVAVV' };
  const draw = (text, x, y, font = fonts[0], color = rgb(0, 0, 0)) => {
    page.drawText(text, { x, y, size: 18, font, color });
    return x + font.widthOfTextAtSize(text, 18) + 3;
  };
  draw('Second line', 40, 650);
  draw('Left column', 40, 600); draw('Right column', 350, 600);
  draw('Serif', draw('Sans', 40, 550), 550, fonts[3]);
  draw('Bold', draw('Regular', 40, 500), 500, fonts[2]);
  draw('Red', draw('Black', 40, 450), 450, fonts[0], rgb(.7, 0, 0));
  const boundaries = ['Second line', 'Left column', 'Right column', 'Sans', 'Serif', 'Regular', 'Bold', 'Black', 'Red'];
  return { bytes: await pdf.save(), heading, boundaries };
}
