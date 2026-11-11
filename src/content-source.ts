import type { OpenSource } from "./documentTabs";

export const CONTENT_ACCEPT = "application/pdf,.pdf,.doc,.docx,.xlsx,.md,.markdown,.txt,.csv,.svg,.html,.htm,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif";
/** The browser edition's picker filter: Word and Excel files open in the desktop app only. */
/** Electron adds this to the message of an error thrown in the main process. */
export const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;
export const BROWSER_ACCEPT = CONTENT_ACCEPT.replace(",.doc,.docx,.xlsx", "");
const XLSX = /\.xlsx?$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const TEXT = /\.txt$/i;
const CSV = /\.csv$/i;
const HTML = /\.html?$/i;
const SVG = /\.svg$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

/**
 * CSV line endings: rows end with `eol`, line breaks inside quoted cells use `cellEol`, each the dominant one of its kind.
 * A cell break defaults to "\n" (what Excel writes); rows default to the cell ending. Mixed row endings normalize to the
 * dominant one (accepted). Keep in sync with csvEndings in electron/content-files.cjs.
 */
// shortcut: a quote in the middle of a cell also toggles, so malformed quotes can misclassify later breaks; upgrade if real files show it.
export function csvEndings(raw: string): { eol: string; cellEol: string } {
  const counts: Record<string, number>[] = [{}, {}];
  let inside = 0;
  for (const [token] of raw.matchAll(/"|\r\n|\n|\r/g)) {
    if (token === '"') inside ^= 1; else counts[inside][token] = (counts[inside][token] ?? 0) + 1;
  }
  const top = (count: Record<string, number>) => ["\r\n", "\n", "\r"].reduce((best, ending) => (count[ending] ?? 0) > (count[best] ?? 0) ? ending : best, "");
  const cellEol = top(counts[1]) || "\n";
  return { eol: top(counts[0]) || cellEol, cellEol };
}

/** Writes the editor's "\n" back as the file's own endings. Keep in sync with csvRestore in electron/content-files.cjs. */
export function csvRestore(text: string, eol: string, cellEol: string): string {
  let inside = false;
  return text.replace(/"|\n/g, char => char === '"' ? ((inside = !inside), char) : inside ? cellEol : eol);
}

/**
 * The editor text back as file text: a .csv, .txt or .svg gets its own line endings (and BOM when it had one, or `bom` forces it).
 * Markdown is returned as is. The text always uses "\n" in the editor.
 */
export function restoreText(doc: Pick<MarkdownDocument, "format" | "bom" | "eol" | "cellEol">, text: string, bom = false): string {
  const mark = bom || doc.bom ? "\ufeff" : "";
  return doc.format === "csv" ? mark + csvRestore(text, doc.eol ?? "\n", doc.cellEol ?? "\n")
    : doc.format === "text" || doc.format === "svg" ? mark + text.replace(/\n/g, doc.eol ?? "\n") : text;
}

/**
 * An SVG exported as UTF-8 must not keep another encoding in its XML declaration: a browser would read the bytes as mojibake.
 * Only a leading <?xml ... encoding="..."?> naming a non-UTF-8 encoding changes. Same regex and vectors (scripts/svg-xml-encoding.json)
 * as electron/content-files.cjs.
 */
export const xmlUtf8 = (text: string) => text.replace(/^(\ufeff?\s*<\?xml\s[^?]*?\bencoding\s*=\s*)(["'])(?!utf-?8\2)[^"']*\2/i, "$1$2UTF-8$2");

export async function localSources(files: File[]): Promise<OpenSource[]> {
  const browserImages = !window.folioDesktop ? files.filter(file => IMAGE.test(file.name)) : [];
  const sources = await Promise.all(files.map(async (file): Promise<OpenSource | null> => {
    try {
      if (MARKDOWN.test(file.name) || TEXT.test(file.name) || CSV.test(file.name) || SVG.test(file.name) || HTML.test(file.name) || IMAGE.test(file.name)) {
        if (window.folioDesktop) {
          const document = await window.folioDesktop.content.open(file);
          return { kind: "content", name: document.name, document };
        }
        if (MARKDOWN.test(file.name)) {
          if (file.size > 5 * 1024 * 1024) throw new Error("Markdown files must be smaller than 5 MB.");
          const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
          return { kind: "content", name: file.name, document: { kind: "markdown", name: file.name, text } };
        }
        if (TEXT.test(file.name) || CSV.test(file.name) || SVG.test(file.name) || HTML.test(file.name)) {
          const csv = CSV.test(file.name), format = HTML.test(file.name) ? "html" : SVG.test(file.name) ? "svg" : "text";
          if (file.size > 5 * 1024 * 1024) throw new Error(`${csv ? "CSV" : format === "html" ? "HTML" : format === "svg" ? "SVG" : "Text"} files must be smaller than 5 MB.`);
          const bytes = new Uint8Array(await file.arrayBuffer());
          let text: string;
          // The browser edition reads UTF-8 only; the desktop app also reads UTF-16 and Windows encodings.
          try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
          catch { throw new Error("This file isn't UTF-8 text. Open it in the Doko desktop app to read other encodings."); }
          if (text.includes("\0")) throw new Error("This file isn't plain text.");
          // The editor's text always uses "\n" (and a CSV table addresses it); the file's BOM and line endings return on download.
          const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
          if (!csv) {
            const eol = text.match(/\r\n|\n|\r/)?.[0] ?? "\n";
            return { kind: "content", name: file.name, document: { kind: "markdown", name: file.name, text: text.replace(/\r\n|\r/g, "\n"), format, ...(bom && { bom }), ...(eol !== "\n" && { eol }) } };
          }
          const { eol, cellEol } = csvEndings(text);
          return { kind: "content", name: file.name, document: { kind: "markdown", name: file.name, text: text.replace(/\r\n|\r/g, "\n"), format: "csv",
            ...(bom && { bom }), ...(eol !== "\n" && { eol }), ...(cellEol !== "\n" && { cellEol }) } };
        }
        if (file !== browserImages[0]) return null;
        const blobs = Object.fromEntries(browserImages.map(image => [image.name, image]));
        return { kind: "content", name: file.name, document: { kind: "gallery", name: "Selected images",
          files: Object.keys(blobs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }) || a.localeCompare(b)),
          selected: file.name, blobs } };
      }
      if (window.folioDesktop && /\.docx?$/i.test(file.name)) return { kind: "word", name: file.name, file };
      // .xls goes to the reader as well: it explains that old workbooks must be saved as .xlsx.
      if (XLSX.test(file.name)) {
        if (window.folioDesktop) return { kind: "workbook", name: file.name, file };
        throw new Error("Excel workbooks open in the Doko desktop app.");
      }
      if (!file.type || /\.pdf$/i.test(file.name) || file.type === "application/pdf") return { kind: "blob", name: file.name, blob: file };
      throw new Error("This file type isn't supported. Choose a PDF, Markdown document, text file, CSV file, SVG file, HTML document, or image.");
    } catch (error) {
      return { kind: "error", name: file.name, message: `Couldn't open “${file.name}”. ${(error as Error).message.replace(IPC_PREFIX, "")}` };
    }
  }));
  return sources.filter((source): source is OpenSource => source !== null);
}
