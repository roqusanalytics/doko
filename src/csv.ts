// Pure CSV parser and text-edit helpers. A table is only a view of the source text:
// every edit returns text changes against the original text, never a new table.
export type CsvDelimiter = string;
export type CsvLineEnding = "\n" | "\r\n" | "\r";
export type CsvChange = { from: number; to: number; insert: string };

export type CsvCell = {
  /** Raw cell range in the source text, including surrounding quotes. */
  from: number;
  to: number;
  /** Decoded value: quotes removed and "" unescaped. */
  value: string;
};

export type CsvRow = {
  /** Start of the first cell. */
  from: number;
  /** End of the last cell, before the line terminator. */
  to: number;
  /** End including the line terminator (equals `to` for an unterminated last row). */
  end: number;
  /** A blank line is one empty cell. Rows are ragged: no padding. */
  cells: CsvCell[];
};

export type CsvTable = {
  delimiter: CsvDelimiter;
  /** Dominant terminator of data rows; "\n" when the text has none. */
  lineEnding: CsvLineEnding;
  /** True when the text starts with U+FEFF. Offsets still count it. */
  bom: boolean;
  /** True when the first line is an Excel `sep=X` directive (not a data row). */
  sep: boolean;
  rows: CsvRow[];
  /** True when the last cell of the last row opens a quote that never closes, so it runs to the end of the text. */
  unterminated: boolean;
  /** Maximum cell count over all rows. */
  columns: number;
};

const CANDIDATES = [",", ";", "\t", "|"] as const;
// Exact-tie priority only: a decimal-comma file with ';' has as many commas as semicolons.
const TIE_PRIORITY = ["\t", ";", "|", ","];
const DETECT_LINES = 20;
const DETECT_CHARS = 100_000;

const QUOTE = 34;
const LF = 10;
const CR = 13;

/** Pick the candidate with the most consistent non-zero count outside quotes over the first lines. */
function detectDelimiter(text: string, start: number): string {
  const n = Math.min(text.length, start + DETECT_CHARS);
  const counts: number[][] = CANDIDATES.map(() => []);
  const cur = [0, 0, 0, 0];
  let inQuotes = false;
  let lines = 0;
  let any = false;
  for (let i = start; i < n && lines < DETECT_LINES; i++) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) { inQuotes = !inQuotes; any = true; continue; }
    if (inQuotes) continue;
    if (c === LF || c === CR) {
      if (c === CR && text.charCodeAt(i + 1) === LF) i++;
      if (any) { for (let k = 0; k < 4; k++) { counts[k].push(cur[k]); cur[k] = 0; } lines++; }
      any = false;
      continue;
    }
    any = true;
    const k = c === 44 ? 0 : c === 59 ? 1 : c === 9 ? 2 : c === 124 ? 3 : -1;
    if (k >= 0) cur[k]++;
  }
  if (any && lines < DETECT_LINES) for (let k = 0; k < 4; k++) counts[k].push(cur[k]);
  let best = ",";
  let bestFreq = 0;
  let bestCount = 0;
  for (let k = 0; k < 4; k++) {
    // Most frequent non-zero count; ties go to the larger count.
    const freq = new Map<number, number>();
    let freqOf = 0;
    let countOf = 0;
    for (const v of counts[k]) {
      if (!v) continue;
      const f = (freq.get(v) ?? 0) + 1;
      freq.set(v, f);
      if (f > freqOf || (f === freqOf && v > countOf)) { freqOf = f; countOf = v; }
    }
    if (!freqOf) continue;
    const d = CANDIDATES[k];
    const better = freqOf > bestFreq || (freqOf === bestFreq && (countOf > bestCount
      || (countOf === bestCount && TIE_PRIORITY.indexOf(d) < TIE_PRIORITY.indexOf(best))));
    if (better) { best = d; bestFreq = freqOf; bestCount = countOf; }
  }
  return best;
}

/**
 * Single pass, never throws. Malformed quotes are kept literally; an unterminated quote runs to EOF.
 * `forceDelimiter` skips detection (a `sep=` line still wins); pin it after edits so a changed cell cannot flip detection.
 */
export function parseCsv(text: string, forceDelimiter?: CsvDelimiter): CsvTable {
  const n = text.length;
  const bom = n > 0 && text.charCodeAt(0) === 0xfeff;
  let i = bom ? 1 : 0;
  let sep = false;
  let delimiter = "";
  let crlf = 0, lf = 0, cr = 0;

  // Excel directive: "sep=X" alone on the first line.
  if (n - i >= 5 && (text.charCodeAt(i) | 32) === 115 && (text.charCodeAt(i + 1) | 32) === 101
    && (text.charCodeAt(i + 2) | 32) === 112 && text.charCodeAt(i + 3) === 61) {
    const x = text.charCodeAt(i + 4);
    const after = text.charCodeAt(i + 5);
    if (x !== QUOTE && x !== LF && x !== CR && (i + 5 === n || after === LF || after === CR)) {
      sep = true;
      delimiter = text[i + 4];
      i += 5;
      if (i < n) {
        if (text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF) { crlf++; i += 2; }
        else { if (text.charCodeAt(i) === CR) cr++; else lf++; i++; }
      }
    }
  }
  if (!sep) delimiter = forceDelimiter?.length === 1 ? forceDelimiter : detectDelimiter(text, i);
  const dc = delimiter.charCodeAt(0);

  const rows: CsvRow[] = [];
  let columns = 0;
  let unterminated = false;
  while (i < n) {
    const cells: CsvCell[] = [];
    const rowFrom = i;
    for (;;) {
      const from = i;
      let value: string;
      let c = text.charCodeAt(i);
      if (c === QUOTE) {
        let j = i + 1;
        let escaped = false;
        let closed = -1;
        for (;;) {
          const q = text.indexOf('"', j);
          if (q < 0) break;
          if (text.charCodeAt(q + 1) === QUOTE) { escaped = true; j = q + 2; continue; }
          closed = q;
          break;
        }
        const inner = text.slice(i + 1, closed < 0 ? n : closed);
        value = escaped ? inner.replaceAll('""', '"') : inner;
        unterminated = closed < 0;
        i = closed < 0 ? n : closed + 1;
        // Stray text after a closing quote: keep it literally, up to the next delimiter or terminator.
        const tail = i;
        for (; i < n; i++) { c = text.charCodeAt(i); if (c === dc || c === LF || c === CR) break; }
        if (i > tail) value += text.slice(tail, i);
      } else {
        for (; i < n; i++) { c = text.charCodeAt(i); if (c === dc || c === LF || c === CR) break; }
        value = text.slice(from, i);
      }
      cells.push({ from, to: i, value });
      if (i < n && text.charCodeAt(i) === dc) { i++; continue; }
      break;
    }
    const to = i;
    if (i < n) {
      if (text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF) { crlf++; i += 2; }
      else { if (text.charCodeAt(i) === CR) cr++; else lf++; i++; }
    }
    if (cells.length > columns) columns = cells.length;
    rows.push({ from: rowFrom, to, end: i, cells });
  }
  const lineEnding: CsvLineEnding = crlf >= lf && crlf >= cr && crlf > 0 ? "\r\n" : lf >= cr && lf > 0 ? "\n" : cr > 0 ? "\r" : "\n";
  return { delimiter, lineEnding, bom, sep, rows, unterminated, columns };
}

/**
 * Quote only when needed: the delimiter or any detectable delimiter (so a reopened file is never re-split by detection),
 * quote, CR/LF, or leading/trailing space.
 */

/**
 * Parses with the delimiter pinned for this file, so editing a cell cannot change how it is split. A pin that leaves the
 * table with one column is released and the text is detected again: that is how a rewritten separator is followed.
 */
export function parseCsvPinned(text: string, pinned?: CsvDelimiter): CsvTable {
  const table = parseCsv(text, pinned);
  if (table.columns > 1 || !pinned) return table;
  const detected = parseCsv(text);
  return detected.columns > 1 ? detected : table;
}
export function encodeCell(value: string, delimiter: CsvDelimiter): string {
  if (!value) return value;
  const needs = value.includes(delimiter) || /[,;\t|]/.test(value) || value.includes('"') || value.includes("\n") || value.includes("\r")
    || value.charCodeAt(0) === 32 || value.charCodeAt(value.length - 1) === 32;
  return needs ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Apply changes that all refer to the original text. Equal `from` keeps the given order. */
export function applyChanges(text: string, changes: readonly CsvChange[]): string {
  const sorted = changes.length < 2 ? changes : [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let out = "";
  let pos = 0;
  for (const c of sorted) {
    if (c.from < pos || c.to < c.from) throw new RangeError("Overlapping or invalid CSV changes");
    out += text.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  return out + text.slice(pos);
}

function rowAt(table: CsvTable, row: number): CsvRow {
  const r = table.rows[row];
  if (!r) throw new RangeError(`CSV row ${row} does not exist`);
  return r;
}

/** Text appended after the last row's end must first close that row's unterminated quote, or it lands inside the cell. */
const closeQuote = (table: CsvTable, row: CsvRow) => table.unterminated && row === table.rows[table.rows.length - 1] ? '"' : "";

/** Replace one cell. A short row is padded with delimiters. Unchanged values yield no change. */
export function setCell(table: CsvTable, row: number, col: number, value: string): CsvChange[] {
  const r = rowAt(table, row);
  const cell = r.cells[col];
  // An emptied sole cell of an unterminated last row would erase the row: keep it as a quoted empty cell.
  const insert = !value && r.cells.length === 1 && r.end === r.to ? '""' : encodeCell(value, table.delimiter);
  if (cell) return cell.value === value ? [] : [{ from: cell.from, to: cell.to, insert }];
  return [{ from: r.to, to: r.to, insert: closeQuote(table, r) + table.delimiter.repeat(col - r.cells.length + 1) + insert }];
}

/** Insert an empty row before `index` (`rows.length` appends). Keeps the file's trailing-newline style. */
export function insertRow(table: CsvTable, text: string, index: number): CsvChange[] {
  const { rows, lineEnding: eol } = table;
  if (index < 0 || index > rows.length) throw new RangeError(`CSV row index ${index} is out of range`);
  const empty = table.delimiter.repeat(Math.max(table.columns, 1) - 1);
  if (index < rows.length) return [{ from: rows[index].from, to: rows[index].from, insert: empty + eol }];
  const start = table.bom ? 1 : 0;
  const last = text.charCodeAt(text.length - 1);
  if (!table.unterminated && (text.length === start || last === LF || last === CR)) return [{ from: text.length, to: text.length, insert: empty + eol }];
  // No trailing newline (or an unterminated quote, whose newline is cell text): a bare terminator would add no row when the new row is blank, so close it too.
  return [{ from: text.length, to: text.length, insert: closeQuote(table, rows[rows.length - 1]) + eol + empty + (empty ? "" : eol) }];
}

/**
 * Delete a row with its terminator. Deleting an unterminated last row also removes the previous terminator,
 * unless the previous row is a blank line (its terminator is the row itself).
 */
export function deleteRow(table: CsvTable, index: number): CsvChange[] {
  const r = rowAt(table, index);
  const prev = table.rows[index - 1];
  if (r.end === r.to && prev && prev.to > prev.from) return [{ from: prev.to, to: r.to, insert: "" }];
  return [{ from: r.from, to: r.end, insert: "" }];
}

/** Insert an empty column before `index`. Rows with fewer than `index` cells are left alone. */
export function insertColumn(table: CsvTable, index: number): CsvChange[] {
  if (index < 0) throw new RangeError(`CSV column index ${index} is out of range`);
  const changes: CsvChange[] = [];
  for (const r of table.rows) {
    if (r.cells.length < index) continue;
    const at = index < r.cells.length ? r.cells[index].from : r.to;
    changes.push({ from: at, to: at, insert: (index < r.cells.length ? "" : closeQuote(table, r)) + table.delimiter });
  }
  return changes;
}

/** Delete column `index`. Rows without it are left alone; a single-cell row becomes a blank line. */
export function deleteColumn(table: CsvTable, index: number): CsvChange[] {
  if (index < 0) throw new RangeError(`CSV column index ${index} is out of range`);
  const changes: CsvChange[] = [];
  for (const r of table.rows) {
    const cells = r.cells;
    if (index >= cells.length) continue;
    const cell = cells[index];
    const rest = cells[index ? 0 : 1];
    // An unterminated last row left with no text would vanish: keep it as one quoted empty cell.
    if (r.end === r.to && cells.length <= 2 && (cells.length === 1 || rest.from === rest.to)) changes.push({ from: r.from, to: r.to, insert: '""' });
    else if (cells.length === 1) changes.push({ from: cell.from, to: cell.to, insert: "" });
    else if (index < cells.length - 1) changes.push({ from: cell.from, to: cells[index + 1].from, insert: "" });
    else changes.push({ from: cells[index - 1].to, to: cell.to, insert: "" });
  }
  return changes;
}
