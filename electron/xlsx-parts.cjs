// The first half of Doko's read-only Excel viewer (xlsx-worker.cjs runs it): turns the bytes of an .xlsx into plain
// tables of display strings. The file is untrusted, so formulas are never evaluated (the cached value is shown),
// nothing external is followed, and every step is bounded. Pure: no Electron, no disk.
const { boundedParts } = require("./docx-parts.cjs");
const { MAX_HTML_BYTES } = require("./document-files.cjs");

// entries, part, total and html mean what they mean in DOCX_LIMITS (boundedParts enforces them). The rest bound the
// tables: sheets read, cells per sheet and overall (counting the empty strings that pad sparse rows and the empty rows
// between used ones), characters overall (so the JSON stays within html), and characters in one cell (Excel's own limit).
const XLSX_LIMITS = {
  entries: 4096, part: 32 * 1024 ** 2, total: 96 * 1024 ** 2, html: MAX_HTML_BYTES,
  sheets: 256, sheetCells: 1_000_000, totalCells: 2_000_000, totalChars: 12_000_000, cellChars: 32767,
};
const MAX_COLUMN = 16384; // XFD
const MAX_ROW = 1048576;

const userError = (message, userMessage) => Object.assign(new Error(message), { userMessage });
const invalid = (message) => userError(message, "This isn't a valid .xlsx workbook.");

const OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENCRYPTED_STREAM = Buffer.from("EncryptedPackage", "utf16le"); // a stream name in the OLE directory

// A password-protected .xlsx and a legacy .xls are both OLE containers, not ZIP files.
function checkContainer(bytes) {
  if (!bytes.subarray(0, OLE_HEADER.length).equals(OLE_HEADER)) return;
  throw bytes.includes(ENCRYPTED_STREAM)
    ? userError("Password-protected workbook.", "This workbook is password-protected. Remove the password in Excel, then open it again.")
    : userError("Legacy .xls workbook.", "Old .xls files aren't supported. Save it as .xlsx in Excel, then open it again.");
}

// ---- XML -------------------------------------------------------------------------------------------------------
// A small pull scanner for the subset of XML that OOXML uses. A DOCTYPE matches no token, so it fails as malformed:
// there are no entities to declare, expand, or fetch, and only the five predefined ones and numeric references are
// decoded. Names lose their namespace prefix (x:c is c). Handlers may set `stop` to end the scan early.
// Both patterns must stay linear on hostile input: the tag name is captured in a lookahead and replayed with \3, which
// stops the engine from retrying shorter names (an atomic group), and an attribute name can only start at the start of a
// name-like run, so a long run with no "=" is scanned once, not once per character.
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<(\/?)(?=([A-Za-z_][\w.:-]*))\3((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/y;
const ATTRIBUTE = /(?<![\w.:-])([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g;
const NO_ATTRIBUTES = Object.freeze({});
const NAMED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const local = (name) => name.slice(name.indexOf(":") + 1);

const decode = (text) => (text.includes("&") ? text.replace(ENTITY, (_, ref) => {
  if (ref[0] !== "#") return NAMED[ref];
  const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
}) : text);

function attributesOf(raw) {
  if (!raw.trim()) return NO_ATTRIBUTES;
  const attributes = {};
  for (const [, name, double, single] of raw.matchAll(ATTRIBUTE)) attributes[local(name)] = decode(double ?? single);
  return attributes;
}

function scan(xml, handler) {
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  TOKEN.lastIndex = 0;
  while (!handler.stop && TOKEN.lastIndex < xml.length) {
    const token = TOKEN.exec(xml);
    if (!token) throw invalid("Malformed XML.");
    const [, cdata, closing, name, rawAttributes, selfClosing, text] = token;
    if (name) {
      const tag = local(name);
      if (closing) { handler.close?.(tag); continue; }
      handler.open?.(tag, attributesOf(rawAttributes));
      if (selfClosing) handler.close?.(tag);
    } else if (cdata !== undefined) {
      handler.text?.(cdata);
    } else if (text !== undefined) {
      handler.text?.(decode(text));
    }
  }
}

// Excel writes characters XML can't hold as _xHHHH_ (a literal "_x0041_" is written _x005F_x0041_).
const unescapeText = (text) => (text.includes("_x") ? text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : text);

// ---- Package ---------------------------------------------------------------------------------------------------
// Targets are relative to xl/ unless they start with "/". One that climbs out of the archive is rejected, not clamped.
function resolveTarget(target) {
  const parts = target.startsWith("/") ? [] : ["xl"];
  for (const part of target.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) throw invalid("A relationship target escapes the archive.");
  }
  return parts.join("/");
}

function readRelationships(xml) {
  const relationships = new Map();
  scan(xml, {
    open(tag, a) {
      if (tag === "Relationship" && a.Id && a.Target && a.TargetMode !== "External") relationships.set(a.Id, { type: a.Type ?? "", part: resolveTarget(a.Target) });
    },
  });
  return relationships;
}

// Text of every <t> except phonetic guides (<rPh>), joined across rich-text runs.
function readSharedStrings(xml) {
  const strings = [];
  let current = null;
  let phonetic = 0;
  let inText = false;
  scan(xml, {
    open(tag) {
      if (tag === "si") current = "";
      else if (current === null) return;
      else if (tag === "rPh") phonetic++;
      else if (tag === "t" && !phonetic) inText = true;
    },
    close(tag) {
      if (tag === "t") inText = false;
      else if (tag === "rPh") phonetic--;
      else if (tag === "si") { strings.push(unescapeText(current ?? "")); current = null; }
    },
    text(text) { if (inText) current += text; },
  });
  return strings;
}

// ---- Dates -----------------------------------------------------------------------------------------------------
// Built-in number formats that are dates or times, by the kinds below. (Ids 27-36 and 50-58 are East Asian formats.)
const BUILT_IN_KINDS = new Map();
for (const id of [14, 15, 16, 17, 27, 28, 29, 30, 31, 36, 50, 51, 54, 57, 58]) BUILT_IN_KINDS.set(id, "date");
for (const id of [18, 19, 20, 21, 32, 33, 34, 35, 45, 47, 52, 53, 55, 56]) BUILT_IN_KINDS.set(id, "time");
BUILT_IN_KINDS.set(22, "datetime");
BUILT_IN_KINDS.set(46, "elapsed"); // [h]:mm:ss

// "date", "time", "datetime", "elapsed" (hours past 24, as in [h]:mm:ss), or null for a number format. Text inside
// quotes or after a backslash, spacing and fill codes, and [colors], [conditions] and [$-locale] tags aren't tokens.
const MAX_FORMAT_CODE = 255; // Excel's own limit; a longer code isn't one Excel wrote
function kindOfCode(code) {
  if (code.length > MAX_FORMAT_CODE) return null;
  let rest = code.replace(/"[^"]*"|\\.|_.|\*./g, "");
  const elapsed = /\[(?:h+|m+|s+)\]/i.test(rest);
  rest = rest.replace(/\[[^\][]*\]/g, "").split(";")[0];
  if (/^\s*general\s*$/i.test(rest)) return null;
  const time = /h|s|am\/pm|a\/p/i.test(rest);
  const date = /[yd]/i.test(rest) || (!time && /m/i.test(rest)); // m is minutes beside h or s, otherwise the month
  return elapsed ? "elapsed" : date && time ? "datetime" : date ? "date" : time ? "time" : null;
}

// Excel's 1900 system counts a 29 February 1900 that never existed: serial 60 is that day, and every serial from
// 61 on is one day later than the real calendar says. The 1904 system has no such bug.
const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");

function formatDate(serial, kind, date1904) {
  if (!(serial >= 0 && serial < 2958466)) return null; // not a date Excel can show
  const seconds = Math.round(serial * 86400);
  const days = Math.floor(seconds / 86400);
  const rest = seconds - days * 86400;
  const clock = `${pad(Math.floor(rest / 3600))}:${pad(Math.floor(rest / 60) % 60)}:${pad(rest % 60)}`;
  if (kind === "time") return clock;
  if (kind === "elapsed") return `${pad(Math.floor(seconds / 3600))}:${clock.slice(3)}`;
  let day;
  if (date1904) day = new Date(Date.UTC(1904, 0, 1) + days * DAY_MS).toISOString().slice(0, 10);
  else if (days === 0) day = "1900-01-00";
  else if (days === 60) day = "1900-02-29";
  else day = new Date(Date.UTC(1899, 11, days < 60 ? 31 : 30) + days * DAY_MS).toISOString().slice(0, 10);
  return kind === "date" ? day : `${day} ${clock}`;
}

// shortcut: numbers show as plain values (no currency, percent, thousands separators or fixed decimals), upgrade when the viewer must match Excel's own display.
const numberText = (raw, kind, date1904) => {
  const number = Number(raw);
  if (raw === "" || !Number.isFinite(number)) return raw;
  return (kind && formatDate(number, kind, date1904)) || String(Number(number.toPrecision(15))); // 15 digits: Excel's precision
};

// Date kind of each cell format (xf), by its position in styles.xml's cellXfs.
function readStyleKinds(xml) {
  const codes = new Map();
  const formats = [];
  let inFormats = false;
  scan(xml, {
    open(tag, a) {
      if (tag === "numFmt") codes.set(Number(a.numFmtId), a.formatCode ?? "");
      else if (tag === "cellXfs") inFormats = true;
      else if (tag === "xf" && inFormats) formats.push(Number(a.numFmtId) || 0);
    },
    close(tag) { if (tag === "cellXfs") inFormats = false; },
  });
  const kinds = new Map(); // one classification per format id, however many xfs share it
  return formats.map((id) => {
    if (!kinds.has(id)) kinds.set(id, codes.has(id) ? kindOfCode(codes.get(id)) : BUILT_IN_KINDS.get(id) ?? null);
    return kinds.get(id);
  });
}

// ---- Worksheets ------------------------------------------------------------------------------------------------
function columnOf(letters) {
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return column;
}

function readRow(text) {
  const row = Number(text);
  if (!Number.isInteger(row) || row < 1 || row > MAX_ROW) throw invalid("A row number is outside Excel's limits.");
  return row - 1;
}

function readReference(reference) {
  const match = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(reference);
  const column = match && columnOf(match[1]);
  if (!match || column > MAX_COLUMN) throw invalid("A cell reference is outside Excel's limits.");
  return [readRow(match[2]), column - 1];
}

// `budget` carries what is left of the overall limits across sheets. Blank cells are skipped, so only a cell with a
// value can make its row longer: rows end at their last value, and a sheet's trailing empty rows are never created.
function readSheet(xml, workbook, budget, limits) {
  const rows = [];
  let slots = 0;
  let truncated = false;
  let rowIndex = -1;
  let nextColumn = 0;
  let cell = null;
  let field = null; // "v", or "t" for text inside an inline string
  let phonetic = 0;

  const grow = (count) => {
    if (slots + count > limits.sheetCells || budget.cells + count > limits.totalCells) return false;
    slots += count;
    budget.cells += count;
    return true;
  };
  const place = (row, column, text) => {
    const line = rows[row];
    const needed = Math.max(0, row + 1 - rows.length) + Math.max(0, column + 1 - (line?.length ?? 0));
    budget.chars += text.length;
    if (budget.chars > limits.totalChars || !grow(needed)) return false;
    while (rows.length <= row) rows.push([]);
    while (rows[row].length < column) rows[row].push("");
    rows[row][column] = text;
    return true;
  };
  const valueOf = ({ type, value, inline, style }) => {
    if (type === "s") return /^\d+$/.test(value.trim()) ? workbook.strings[Number(value)] ?? "" : ""; // already unescaped
    if (type === "inlineStr") return unescapeText(inline);
    if (type === "str" || type === "e" || type === "d") return unescapeText(value);
    if (type === "b") return value.trim() === "" ? "" : /^(1|true)$/.test(value.trim()) ? "TRUE" : "FALSE";
    return numberText(value.trim(), workbook.kinds[style], workbook.date1904);
  };

  const handler = {
    open(tag, a) {
      if (tag === "row") {
        rowIndex = a.r ? readRow(a.r) : rowIndex + 1;
        nextColumn = 0;
      } else if (tag === "c") {
        let row = rowIndex;
        let column = nextColumn;
        if (a.r) [row, column] = readReference(a.r);
        if (column >= MAX_COLUMN) throw invalid("A cell reference is outside Excel's limits.");
        nextColumn = column + 1;
        cell = { row, column, type: a.t ?? "n", style: Number(a.s) || 0, value: "", inline: "" };
      } else if (!cell) {
        return;
      } else if (tag === "v") {
        field = "v";
      } else if (tag === "rPh") {
        phonetic++;
      } else if (tag === "t" && cell.type === "inlineStr" && !phonetic) {
        field = "t";
      }
    },
    close(tag) {
      if (tag === "v" || tag === "t") field = null;
      else if (tag === "rPh") phonetic--;
      else if (tag === "c" && cell) {
        const text = valueOf(cell).slice(0, limits.cellChars);
        if (text !== "" && !place(cell.row, cell.column, text)) { truncated = true; handler.stop = true; }
        cell = null;
      }
    },
    text(text) {
      if (field === "v") cell.value += text;
      else if (field === "t") cell.inline += text;
    },
  };
  scan(xml, handler);
  return { rows, truncated };
}

// ---- Workbook --------------------------------------------------------------------------------------------------
/**
 * Reads the bytes of an .xlsx into `{ sheets: [{ name, rows, truncated }], truncated }`: every worksheet in workbook
 * order (hidden ones too; chart sheets are skipped), each row a list of display strings that ends at its last value.
 * Rejects with an error carrying a `userMessage` when the file can't be shown.
 */
async function parseWorkbook(bytes, limits = XLSX_LIMITS) {
  checkContainer(bytes);
  let parts;
  try { parts = await boundedParts(bytes, limits); }
  catch (error) { throw error.userMessage ? error : Object.assign(invalid(error.message), { cause: error }); }
  const read = async (name, encoding = "utf8") => { // encoding null returns the bytes without decoding them
    if (!parts.exists(name)) throw invalid(`Missing workbook part ${name}.`);
    return parts.read(name, encoding);
  };

  const relationships = readRelationships(await read("xl/_rels/workbook.xml.rels"));
  const related = (suffix) => [...relationships.values()].find(({ type, part }) => type.endsWith(suffix) && parts.exists(part))?.part;
  const sheets = [];
  let date1904 = false;
  scan(await read("xl/workbook.xml"), {
    open(tag, a) {
      // Prefixes are stripped, so an extension's <x15:workbookPr chartTrackingRefBase="1"/> is a workbookPr too: only one that carries the attribute counts.
      if (tag === "workbookPr" && a.date1904 !== undefined) date1904 = a.date1904 === "1" || a.date1904 === "true";
      else if (tag === "sheet") sheets.push({ name: a.name ?? "", relationship: relationships.get(a.id) });
    },
  });

  const strings = related("/sharedStrings");
  const styles = related("/styles");
  const workbook = {
    date1904,
    strings: strings ? readSharedStrings(await read(strings)) : [],
    kinds: styles ? readStyleKinds(await read(styles)) : [],
  };
  const budget = { cells: 0, chars: 0, scanned: 0 }; // scanned: bytes of worksheet XML read, so sheets sharing one big part can't multiply the work
  const result = { sheets: [], truncated: false };
  for (const { name, relationship } of sheets) {
    if (!relationship || !relationship.type.endsWith("/worksheet")) continue; // chart sheets, macro sheets, ...
    if (result.sheets.length >= limits.sheets) { result.truncated = true; break; }
    const data = await read(relationship.part, null);
    budget.scanned += data.length;
    const sheet = budget.cells >= limits.totalCells || budget.chars >= limits.totalChars || budget.scanned > limits.total
      ? { rows: [], truncated: true }
      : readSheet(data.toString("utf8"), workbook, budget, limits);
    result.sheets.push({ name, rows: sheet.rows, truncated: sheet.truncated });
    if (sheet.truncated) result.truncated = true;
  }
  return result;
}

module.exports = { parseWorkbook, XLSX_LIMITS };
