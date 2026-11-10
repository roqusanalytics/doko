import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { checkPdfSize } from "./pdfInput";
import { replacePageImage } from "./pdfImageEdit";

export interface EditTarget {
  index: number;
  end: number;
  ordinal?: number;
  kind: "text" | "image";
  label: string;
  /** Unrotated PDF coordinates, shared with pdf.js's page viewport. */
  box: number[];
  style?: { origin: number[]; axis: number[]; size: number; flags: number; bold: boolean; color: string };
}
export type Change = { kind: "text"; index: number; text: string } | { kind: "image"; index: number; file: File };
export type EditorRequest = { source: Uint8Array } | { page: number } | { page: number; change: Change; snapshot: Uint8Array };
export type EditorReply = { page: number; targets: EditTarget[] } | { bytes: Uint8Array } | { error: string; page?: number };

const ready = (async () => {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error("Couldn't load the PDF editor.");
  const engine = await init({ wasmBinary: await response.arrayBuffer() });
  engine.PDFiumExt_Init();
  return engine;
})();
let source: Uint8Array;

function buffer<T>(m: WrappedPdfiumModule, size: number, use: (ptr: number) => T): T {
  const ptr = m.pdfium.wasmExports.malloc(size);
  if (!ptr) throw new Error("There isn't enough memory to edit this PDF.");
  try { return use(ptr); } finally { m.pdfium.wasmExports.free(ptr); }
}

function withPage<T>(m: WrappedPdfiumModule, bytes: Uint8Array, number: number, use: (doc: number, page: number) => T): T {
  return buffer(m, bytes.length, ptr => {
    m.pdfium.HEAPU8.set(bytes, ptr);
    const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, "");
    if (!doc) throw new Error("Couldn't open this PDF for editing.");
    try {
      if (m.EPDF_IsEncrypted(doc) || m.FPDF_GetSignatureCount(doc) > 0) {
        throw new Error("Editing requires an unsigned, unencrypted PDF.");
      }
      const page = m.FPDF_LoadPage(doc, number - 1);
      if (!page) throw new Error("Couldn't open this page.");
      try { return use(doc, page); } finally { m.FPDF_ClosePage(page); }
    } finally { m.FPDF_CloseDocument(doc); }
  });
}

function objectText(m: WrappedPdfiumModule, page: number) {
  const chars = new Map<number, string>();
  const textPage = m.FPDFText_LoadPage(page);
  if (!textPage) return chars;
  try {
    const count = m.FPDFText_CountChars(textPage);
    if (count > 200000) throw new Error("This page contains too much text to edit.");
    for (let i = 0; i < count; i++) {
      if (m.FPDFText_IsGenerated(textPage, i)) continue;
      const object = m.FPDFText_GetTextObject(textPage, i);
      const code = m.FPDFText_GetUnicode(textPage, i);
      if (object && code > 0 && code <= 0x10ffff) chars.set(object, (chars.get(object) ?? "") + String.fromCodePoint(code));
    }
    return chars;
  } finally { m.FPDFText_ClosePage(textPage); }
}

function pageView(m: WrappedPdfiumModule, page: number) {
  const count = m.FPDFPage_CountObjects(page);
  if (count > 20000) throw new Error("This page has too many objects to edit.");
  const chars = objectText(m, page);
  const targets: EditTarget[] = [];
  let imageCount = 0;
  const fonts = new Map<number, string>();
  const fontIdentity = (font: number) => {
    if (!fonts.has(font)) {
      const length = m.FPDFFont_GetBaseFontName(font, 0, 0);
      const name = length ? buffer(m, length, ptr => {
        m.FPDFFont_GetBaseFontName(font, ptr, length);
        return m.pdfium.UTF8ToString(ptr).replace(/^[A-Z]{6}\+/, "");
      }) : "";
      fonts.set(font, [name, m.FPDFFont_GetFlags(font), m.FPDFFont_GetWeight(font)].join("/"));
    }
    return fonts.get(font)!;
  };
  buffer(m, 32, ptr => {
    let previous: { style: string; right: number; x: number; target: EditTarget } | undefined;
    for (let index = 0; index < count; index++) {
      const obj = m.FPDFPage_GetObject(page, index);
      const type = m.FPDFPageObj_GetType(obj);
      const ordinal = type === 3 ? imageCount++ : 0;
      if (type !== 1 && type !== 3) continue;
      if (!m.FPDFPageObj_GetBounds(obj, ptr, ptr + 4, ptr + 8, ptr + 12)) continue;
      const [left, bottom, right, top] = m.pdfium.HEAPF32.subarray(ptr / 4, ptr / 4 + 4);
      const box = [left, bottom, right, top];
      if (type === 3) {
        if (box[2] > box[0] && box[3] > box[1]) targets.push({ index, end: index, ordinal, kind: "image", label: `Image ${ordinal + 1}`, box });
        continue;
      }
      const mode = m.FPDFTextObj_GetTextRenderMode(obj);
      const label = chars.get(obj);
      if (!label || mode < 0 || mode > 2) continue; // Omit invisible OCR and clipping text.
      if (!m.FPDFPageObj_GetMatrix(obj, ptr) || !m.FPDFTextObj_GetFontSize(obj, ptr + 24)) continue;
      const [a, b, c, d, x, y, size] = m.pdfium.HEAPF32.subarray(ptr / 4, ptr / 4 + 7);
      const color = (stroke: boolean) => {
        const get = stroke ? m.FPDFPageObj_GetStrokeColor : m.FPDFPageObj_GetFillColor;
        return get(obj, ptr, ptr + 4, ptr + 8, ptr + 12) ? m.pdfium.HEAP32.subarray(ptr / 4, ptr / 4 + 4).join(",") : null;
      };
      const fill = mode === 1 ? "" : color(false), stroke = mode === 0 ? "" : color(true);
      const style = [fontIdentity(m.FPDFTextObj_GetFont(obj)), size, a, b, c, d, y, fill, stroke, mode, m.FPDFPageObj_GetMarkedContentID(obj)].join("/");
      const gap = previous ? x - previous.right : 0;
      const em = size * a;
      // Many PDFs position each glyph separately. Join consecutive, same-style runs on one horizontal baseline.
      if (previous && previous.target.end === index - 1 && previous.style === style && fill !== null && stroke !== null
        && a > 0 && b === 0 && c === 0 && d > 0 && x > previous.x && gap >= -0.25 * em && gap < 0.65 * em) {
        const target = previous.target;
        const space = gap > 0.16 * em && !/\s$/.test(target.label) && !/^\s/.test(label);
        target.label += (space ? " " : "") + label;
        target.end = index;
        target.box = [Math.min(target.box[0], box[0]), Math.min(target.box[1], box[1]),
          Math.max(target.box[2], box[2]), Math.max(target.box[3], box[3])];
        previous.right = right; previous.x = x;
      } else {
        const font = m.FPDFTextObj_GetFont(obj);
        const ink = (fill || stroke || "0,0,0,255").split(",").slice(0, 3);
        const target: EditTarget = { index, end: index, kind: "text", label, box,
          style: { origin: [x, y], axis: [a, b], size: size * Math.hypot(c, d), flags: m.FPDFFont_GetFlags(font),
            bold: m.FPDFFont_GetWeight(font) >= 600, color: `rgb(${ink.join(" ")})` } };
        targets.push(target);
        previous = { target, style, right, x };
      }
    }
  });

  return { targets: targets.filter(t => t.label.trim() && t.box[2] > t.box[0] && t.box[3] > t.box[1]), imageCount };
}

function save(m: WrappedPdfiumModule, doc: number) {
  const writer = m.PDFiumExt_OpenFileWriter();
  if (!writer) throw new Error("Couldn't create an edited copy.");
  try {
    if (!m.FPDF_SaveAsCopy(doc, writer, 2)) throw new Error("Couldn't write the edited PDF.");
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    checkPdfSize(size);
    return buffer(m, size, ptr => {
      if (m.PDFiumExt_GetFileWriterData(writer, ptr, size) !== size) throw new Error("Couldn't read the edited PDF.");
      return (m.pdfium.HEAPU8 as Uint8Array).slice(ptr, ptr + size);
    });
  } finally { m.PDFiumExt_CloseFileWriter(writer); }
}

function replaceFontRun(m: WrappedPdfiumModule, doc: number, page: number, target: EditTarget, text: string) {
  const objects = Array.from({ length: target.end - target.index + 1 }, (_, offset) => m.FPDFPage_GetObject(page, target.index + offset));
  const fonts = [...new Set(objects.map(obj => m.FPDFTextObj_GetFont(obj)))];
  const preferred = new Map<string, number>();
  const originalLetters = Array.from(target.label), originalFonts: (number | undefined)[] = [], origins: (number | undefined)[] = [];
  const members = new Set(objects), glyphs = new Map<number, { char: string; x: number }[]>();
  buffer(m, 16, ptr => {
    const textPage = m.FPDFText_LoadPage(page);
    if (!textPage) throw new Error("Couldn't read the text positions.");
    try {
      for (let i = 0; i < m.FPDFText_CountChars(textPage); i++) {
        const obj = m.FPDFText_GetTextObject(textPage, i), code = m.FPDFText_GetUnicode(textPage, i);
        if (!members.has(obj) || m.FPDFText_IsGenerated(textPage, i) || !code || code > 0x10ffff) continue;
        if (!m.FPDFText_GetCharOrigin(textPage, i, ptr, ptr + 8)) throw new Error("Couldn't read a text position.");
        const values = glyphs.get(obj) ?? [];
        values.push({ char: String.fromCodePoint(code), x: m.pdfium.HEAPF64[ptr / 8] });
        glyphs.set(obj, values);
      }
    } finally { m.FPDFText_ClosePage(textPage); }
  });
  let cursor = 0;
  for (const obj of objects) {
    const font = m.FPDFTextObj_GetFont(obj);
    for (const { char, x } of glyphs.get(obj) ?? []) {
      if (!preferred.has(char)) preferred.set(char, font);
      while (cursor < originalLetters.length && originalLetters[cursor] !== char) cursor++;
      originalFonts[cursor] = font; origins[cursor++] = x;
    }
  }
  const letters = Array.from(text);
  let prefix = 0, suffix = 0;
  while (prefix < letters.length && prefix < originalLetters.length && letters[prefix] === originalLetters[prefix]) prefix++;
  while (suffix < letters.length - prefix && suffix < originalLetters.length - prefix
    && letters[letters.length - suffix - 1] === originalLetters[originalLetters.length - suffix - 1]) suffix++;
  if (m.FPDFPage_CountObjects(page) - objects.length + letters.length > 20000) throw new Error("This text is too long to edit on this page.");
  const scratchIndex = m.FPDF_GetPageCount(doc), scratch = m.FPDFPage_New(doc, scratchIndex, 100, 100);
  if (!scratch) throw new Error("Couldn't prepare the text edit.");
  const original = objects[0], created: number[] = [], inserted = new Set<number>();
  try {
    buffer(m, 64, ptr => {
      if (!m.FPDFPageObj_GetMatrix(original, ptr) || !m.FPDFTextObj_GetFontSize(original, ptr + 24)) throw new Error("Couldn't read the text style.");
      const matrix = Array.from(m.pdfium.HEAPF32.subarray(ptr / 4, ptr / 4 + 6));
      const size = m.pdfium.HEAPF32[ptr / 4 + 6], mode = m.FPDFTextObj_GetTextRenderMode(original);
      const color = (stroke: boolean) => {
        if (!(stroke ? m.FPDFPageObj_GetStrokeColor : m.FPDFPageObj_GetFillColor)(original, ptr, ptr + 4, ptr + 8, ptr + 12)) throw new Error("Couldn't read the text color.");
        return Array.from(m.pdfium.HEAP32.subarray(ptr / 4, ptr / 4 + 4));
      };
      const fill = color(false), stroke = color(true);
      const strokeWidth = m.FPDFPageObj_GetStrokeWidth(original, ptr) ? m.pdfium.HEAPF32[ptr / 4] : 1;
      const width = (font: number, char: string) => {
        if (!m.FPDFFont_GetGlyphWidth(font, char.codePointAt(0)!, size, ptr)) throw new Error("Couldn't measure this text.");
        return m.pdfium.HEAPF32[ptr / 4] * matrix[0];
      };
      const spacingAfter = (index: number) => {
        const left = origins[index], right = origins[index + 1], font = originalFonts[index];
        return left !== undefined && right !== undefined && font ? right - left - width(font, originalLetters[index]) : 0;
      };
      let x = matrix[4];
      for (const [index, char] of letters.entries()) {
        const sourceIndex = index < prefix ? index : index >= letters.length - suffix
          ? originalLetters.length - letters.length + index : Math.max(0, Math.min(index, originalLetters.length - suffix - 1));
        const retained = index < prefix || index >= letters.length - suffix ? originalFonts[sourceIndex] : undefined;
        let font = retained ?? preferred.get(char);
        if (index < prefix && origins[index] !== undefined) x = origins[index]!;
        if (!font) {
          for (const candidate of fonts) {
            const probe = m.FPDFPageObj_CreateTextObj(doc, candidate, size);
            if (!probe) continue;
            buffer(m, (char.length + 1) * 2, textPtr => { m.pdfium.stringToUTF16(char, textPtr, (char.length + 1) * 2); m.FPDFText_SetText(probe, textPtr); });
            m.FPDFPage_InsertObject(scratch, probe);
            const actual = objectText(m, scratch).get(probe);
            m.FPDFPage_RemoveObject(scratch, probe); m.FPDFPageObj_Destroy(probe);
            if (actual === char) { font = candidate; preferred.set(char, font); break; }
          }
        }
        if (!font) throw new Error("This font can't display all of those characters.");
        const obj = m.FPDFPageObj_CreateTextObj(doc, font, size);
        if (!obj) throw new Error("Couldn't create replacement text.");
        created.push(obj);
        buffer(m, (char.length + 1) * 2, textPtr => {
          m.pdfium.stringToUTF16(char, textPtr, (char.length + 1) * 2);
          if (!m.FPDFText_SetText(obj, textPtr)) throw new Error("Couldn't change this text.");
        });
        m.pdfium.HEAPF32.set([matrix[0], matrix[1], matrix[2], matrix[3], x, matrix[5]], ptr / 4);
        if (!m.FPDFPageObj_SetMatrix(obj, ptr)
          || !m.FPDFPageObj_SetFillColor(obj, fill[0], fill[1], fill[2], fill[3])
          || !m.FPDFPageObj_SetStrokeColor(obj, stroke[0], stroke[1], stroke[2], stroke[3])
          || !m.FPDFPageObj_SetStrokeWidth(obj, strokeWidth) || !m.FPDFTextObj_SetTextRenderMode(obj, mode)) throw new Error("Couldn't preserve the text style.");
        x += width(font, char) + spacingAfter(sourceIndex);
      }
    });
    for (const obj of objects.slice().reverse()) {
      if (!m.FPDFPage_RemoveObject(page, obj)) throw new Error("Couldn't replace the full text run.");
      m.FPDFPageObj_Destroy(obj);
    }
    for (let i = 0; i < created.length; i++) {
      if (!m.FPDFPage_InsertObjectAtIndex(page, created[i], target.index + i)) throw new Error("Couldn't insert the edited text.");
      inserted.add(created[i]);
    }
    const result = objectText(m, page);
    if (created.map(obj => result.get(obj) ?? "").join("") !== text) throw new Error("This font can't display all of those characters.");
  } finally {
    for (const obj of created) if (!inserted.has(obj)) m.FPDFPageObj_Destroy(obj);
    m.FPDF_ClosePage(scratch); m.FPDFPage_Delete(doc, scratchIndex);
  }
}

function replaceText(m: WrappedPdfiumModule, doc: number, page: number, target: EditTarget, text: string) {
  const obj = m.FPDFPage_GetObject(page, target.index);
  if (m.FPDFPageObj_GetType(obj) !== 1 || text.length > 32767 || /[\u0000-\u001f]/u.test(text)) {
    throw new Error("Enter a single line of text.");
  }
  // Type3 font subsets can have no names. Retain their glyph fonts rather than flattening a line into the first subset.
  if (text && new Set(Array.from({ length: target.end - target.index + 1 }, (_, i) => m.FPDFTextObj_GetFont(m.FPDFPage_GetObject(page, target.index + i)))).size > 1) {
    replaceFontRun(m, doc, page, target, text);
    return;
  }
  const firstToRemove = text ? target.index + 1 : target.index;
  for (let i = target.end; i >= firstToRemove; i--) {
    const fragment = m.FPDFPage_GetObject(page, i);
    if (!m.FPDFPage_RemoveObject(page, fragment)) throw new Error("Couldn't replace the full text run.");
    m.FPDFPageObj_Destroy(fragment);
  }
  if (!text) return;
  const size = (text.length + 1) * 2;
  buffer(m, size, ptr => {
    m.pdfium.stringToUTF16(text, ptr, size);
    if (!m.FPDFText_SetText(obj, ptr)) throw new Error("Couldn't change this text.");
  });
  // Subset fonts can silently substitute a missing glyph. Read back the changed object before accepting it.
  if (objectText(m, page).get(obj) !== text) throw new Error("This font can't display all of those characters.");
}

self.onmessage = async ({ data }: MessageEvent<EditorRequest>) => {
  if ("source" in data) { source = data.source; return; }
  try {
    const m = await ready;
    const { page } = data;
    if (!("change" in data)) {
      const { targets } = withPage(m, source, page, (_doc, handle) => pageView(m, handle));
      self.postMessage({ page, targets } satisfies EditorReply);
      return;
    }
    const { change, snapshot } = data;
    const result = withPage(m, snapshot, page, (doc, handle) => {
      const { targets, imageCount } = pageView(m, handle);
      const target = targets.find(t => t.index === change.index && t.kind === change.kind);
      if (!target) throw new Error("Select the item again.");
      if (change.kind === "image") return replacePageImage(snapshot, page, target.ordinal!, imageCount, change.file);
      replaceText(m, doc, handle, target, change.text);
      if (!m.FPDFPage_GenerateContent(handle)) throw new Error("Couldn't write this page.");
      return save(m, doc);
    });
    const bytes = await result;
    self.postMessage({ bytes } satisfies EditorReply, { transfer: [bytes.buffer as ArrayBuffer] });
  } catch (reason) {
    self.postMessage({ error: reason instanceof Error ? reason.message : "Couldn't edit this PDF.",
      page: "change" in data ? undefined : data.page } satisfies EditorReply);
  }
};
