import { PDFDocument, PDFName } from 'pdf-lib';

// Each Type3 font holds one Unicode glyph; using just the first font loses the other letter.
export async function subsetType3Pdf({ variableTracking = false } = {}) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([400, 300]), context = pdf.context;
  const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: 'SubsetFixture', Flags: 4,
    FontBBox: [0, 0, 600, 700], ItalicAngle: 0, Ascent: 700, Descent: 0, CapHeight: 700, StemV: 80 }));
  const font = letter => {
    const outline = letter === 'A' ? '0 0 m 300 700 l 600 0 l h f' : '0 0 600 700 re f';
    const glyph = context.register(context.stream(`600 0 0 0 600 700 d1\n${outline}`));
    const unicode = letter.codePointAt(0).toString(16).padStart(4, '0');
    const cmap = context.register(context.stream(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Fixture${letter} def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n1 beginbfchar\n<41> <${unicode}>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`));
    return context.register(context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 600, 700],
      FontMatrix: [.001, 0, 0, .001, 0, 0], CharProcs: { [letter]: glyph },
      Encoding: { Type: 'Encoding', Differences: [65, PDFName.of(letter)] }, FirstChar: 65, LastChar: 65,
      Widths: [600], Resources: {}, ToUnicode: cmap, FontDescriptor: descriptor }));
  };
  page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: font('A'), F2: font('B') } }));
  const origins = [40, 54.4, variableTracking ? 70.8 : 68.8, 83.2];
  page.node.set(PDFName.of('Contents'), context.register(context.stream([
    'BT /F1 24 Tf 1 0 0 1 40 230 Tm (A) Tj ET',
    'BT /F2 24 Tf 1 0 0 1 54.4 230 Tm (A) Tj ET',
    `BT /F1 24 Tf 1 0 0 1 ${origins[2]} 230 Tm (A) Tj ET`,
    'BT /F2 24 Tf 1 0 0 1 83.2 230 Tm (A) Tj ET',
  ].join('\n'))));
  return { bytes: await pdf.save(), heading: 'ABAB', replacement: 'BABA', origins, variableTracking };
}
