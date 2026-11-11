import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createServer } from "vite";

const server = await createServer({ root: path.resolve(import.meta.dirname, ".."), server: { middlewareMode: true }, appType: "custom" });
after(() => server.close());
const csv = await server.ssrLoadModule("/src/csv.ts");
const { parseCsv, encodeCell, applyChanges, setCell, insertRow, deleteRow, insertColumn, deleteColumn } = csv;

const values = table => table.rows.map(row => row.cells.map(cell => cell.value));

// Offsets must tile the text: rows are contiguous and cells are separated by exactly one delimiter.
function assertCovers(text, table) {
  const start = table.bom ? 1 : 0;
  let pos = table.rows.length ? table.rows[0].from : start;
  assert.ok(pos >= start && pos <= text.length);
  for (const row of table.rows) {
    assert.equal(row.from, pos);
    assert.ok(row.cells.length > 0);
    assert.equal(row.cells[0].from, row.from);
    assert.equal(row.cells.at(-1).to, row.to);
    row.cells.forEach((cell, i) => {
      assert.ok(cell.from <= cell.to);
      if (i) assert.equal(text[cell.from - 1], table.delimiter), assert.equal(row.cells[i - 1].to + 1, cell.from);
    });
    assert.ok(row.to <= row.end && row.end <= text.length);
    assert.ok(/^(\r\n|\r|\n|)$/.test(text.slice(row.to, row.end)));
    pos = row.end;
  }
  if (table.rows.length) assert.equal(pos, text.length);
  assert.equal(table.columns, Math.max(0, ...table.rows.map(r => r.cells.length)));
}

function check(text, expected, extra = {}) {
  const table = parseCsv(text);
  assert.deepEqual(values(table), expected);
  assertCovers(text, table);
  for (const [key, value] of Object.entries(extra)) assert.equal(table[key], value, key);
  return table;
}

test("empty file has zero rows", () => {
  const table = check("", [], { columns: 0, delimiter: ",", lineEnding: "\n", bom: false, sep: false });
  assert.equal(table.rows.length, 0);
  check("\ufeff", [], { bom: true });
});

test("each delimiter is detected", () => {
  check("a,b,c\n1,2,3\n", [["a", "b", "c"], ["1", "2", "3"]], { delimiter: "," });
  check("a;b;c\n1;2;3\n", [["a", "b", "c"], ["1", "2", "3"]], { delimiter: ";" });
  check("a\tb\tc\n1\t2\t3\n", [["a", "b", "c"], ["1", "2", "3"]], { delimiter: "\t" });
  check("a|b|c\n1|2|3\n", [["a", "b", "c"], ["1", "2", "3"]], { delimiter: "|" });
  check("one column\nstill one\n", [["one column"], ["still one"]], { delimiter: ",", columns: 1 });
});

test("detection ignores delimiters inside quotes and prefers consistency", () => {
  check('"a,b,c,d";x;y\n"e,f,g";1;2\n', [["a,b,c,d", "x", "y"], ["e,f,g", "1", "2"]], { delimiter: ";" });
  // Lithuanian Excel: decimal commas next to ';' separators.
  check("Pavadinimas;Kaina;Kiekis\nObuolys;1,50;3\nGruzdai;2,25;10\n", [
    ["Pavadinimas", "Kaina", "Kiekis"], ["Obuolys", "1,50", "3"], ["Gruzdai", "2,25", "10"],
  ], { delimiter: ";" });
  // Free text with an odd comma in one line must not beat a consistent tab.
  check("a\tb\tc\nx, y\tz\tw\nq\tr\ts\n", [["a", "b", "c"], ["x, y", "z", "w"], ["q", "r", "s"]], { delimiter: "\t" });
  assert.equal(parseCsv("a;b\n1;2\n", ",").delimiter, ",");
});

test("sep= directive is not a row and its delimiter wins", () => {
  const text = "sep=;\r\na,b;c\r\n1;2\r\n";
  const table = check(text, [["a,b", "c"], ["1", "2"]], { delimiter: ";", sep: true, lineEnding: "\r\n" });
  assert.equal(table.rows[0].from, "sep=;\r\n".length);
  check("sep=|", [], { sep: true, delimiter: "|" });
  check("\ufeffSEP=\t\na\tb\n", [["a", "b"]], { sep: true, delimiter: "\t", bom: true });
  // Not directives.
  check("sep=;;\n1;2\n", [["sep=", "", ""], ["1", "2"]], { sep: false, delimiter: ";" });
  check('"sep=;"\n', [["sep=;"]], { sep: false });
  assert.equal(parseCsv("sep=;\na,b\n", ",").delimiter, ";");
});

test("quotes, escaped quotes, embedded delimiters and line breaks", () => {
  const text = 'a,"b,c","say ""hi""","line1\nline2","x\r\ny"\n"",plain, spaced \n';
  const table = check(text, [["a", "b,c", 'say "hi"', "line1\nline2", "x\r\ny"], ["", "plain", " spaced "]], { delimiter: "," });
  assert.equal(text.slice(table.rows[0].cells[1].from, table.rows[0].cells[1].to), '"b,c"');
  const empty = table.rows[1].cells[0];
  assert.equal(text.slice(empty.from, empty.to), '""');
  assert.equal(empty.value, "");
  check('"""a"""\n', [['"a"']]);
  check('"a"",b"\n', [['a",b']]);
});

test("line endings: LF, CRLF, CR, mixed, dominant", () => {
  check("a,b\nc,d\n", [["a", "b"], ["c", "d"]], { lineEnding: "\n" });
  check("a,b\r\nc,d\r\n", [["a", "b"], ["c", "d"]], { lineEnding: "\r\n" });
  check("a,b\rc,d\r", [["a", "b"], ["c", "d"]], { lineEnding: "\r" });
  check("a,b\r\nc,d\ne,f\r\ng,h\r", [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]], { lineEnding: "\r\n" });
  check("a,b\nc,d\ne,f\r\ng,h", [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]], { lineEnding: "\n" });
  // Line breaks inside quotes do not count.
  check('"a\r\nb\r\nc",d\n', [["a\r\nb\r\nc", "d"]], { lineEnding: "\n" });
  // CRLF is one terminator, not an empty row between.
  assert.equal(parseCsv("a\r\nb").rows.length, 2);
});

test("trailing newline makes no phantom row; blank lines are rows", () => {
  assert.equal(parseCsv("a,b\n").rows.length, 1);
  assert.equal(parseCsv("a,b").rows.length, 1);
  assert.equal(parseCsv("a,b\r\n").rows.length, 1);
  check("a,b\n\nc,d\n", [["a", "b"], [""], ["c", "d"]]);
  check("a,b\n\n", [["a", "b"], [""]]);
  check("\n", [[""]]);
  check("a,\n", [["a", ""]]);
  check(",", [["", ""]]);
});

test("BOM is excluded from values and offsets stay correct", () => {
  const text = "\ufeffname,age\nAnn,3";
  const table = check(text, [["name", "age"], ["Ann", "3"]], { bom: true });
  assert.equal(table.rows[0].cells[0].from, 1);
  check('\ufeff"quoted",b\n', [["quoted", "b"]], { bom: true });
  check("a,b", [["a", "b"]], { bom: false });
});

test("ragged rows keep their own length", () => {
  const table = check("a,b,c\n1\n1,2,3,4\n\n", [["a", "b", "c"], ["1"], ["1", "2", "3", "4"], [""]], { columns: 4 });
  assert.equal(table.rows[1].cells.length, 1);
});

test("malformed input never throws and keeps ranges consistent", () => {
  check('ab"c,d\n', [['ab"c', "d"]]);
  check('a,"unterminated\nstill,inside', [["a", "unterminated\nstill,inside"]]);
  check('"abc"def,ghi\n', [["abcdef", "ghi"]]);
  check('"', [[""]]);
  check('a,"', [["a", ""]]);
  check('"a""', [['a"']]);
  check('x,"a"b"c",y\n', [["x", 'ab"c"', "y"]]);
  const rand = prng(7);
  const alphabet = ['a', 'b', ',', ';', '\t', '|', '"', '"', '\n', '\r', ' ', 'sep=', '\ufeff'];
  for (let n = 0; n < 4000; n++) {
    let text = "";
    for (let k = rand() * 24 | 0; k > 0; k--) text += alphabet[rand() * alphabet.length | 0];
    const table = parseCsv(text);
    assertCovers(text, table);
    assert.ok(Array.isArray(table.rows));
  }
});

test("encodeCell quotes only when needed", () => {
  assert.equal(encodeCell("plain", ","), "plain");
  assert.equal(encodeCell("", ","), "");
  assert.equal(encodeCell("a,b", ","), '"a,b"');
  // Any detectable delimiter is quoted, not only the file's own: reopening must not re-split the cell.
  assert.equal(encodeCell("a,b", ";"), '"a,b"');
  assert.equal(encodeCell("a|b", ","), '"a|b"');
  assert.equal(encodeCell("a\tb", ","), '"a\tb"');
  assert.equal(encodeCell("a;b", ";"), '"a;b"');
  assert.equal(encodeCell("a\tb", "\t"), '"a\tb"');
  assert.equal(encodeCell('say "hi"', ","), '"say ""hi"""');
  assert.equal(encodeCell("a\nb", ","), '"a\nb"');
  assert.equal(encodeCell("a\rb", ","), '"a\rb"');
  assert.equal(encodeCell(" lead", ","), '" lead"');
  assert.equal(encodeCell("trail ", ","), '"trail "');
  assert.equal(encodeCell("in side", ","), "in side");
});

test("an edited cell holding another delimiter does not change detection when the file is reopened", () => {
  for (const [file, value] of [["name\nbob\n", "x;y"], ["name\nbob\n", "x\ty"], ["name\nbob\n", "x|y"], ["a;b\n1;2\n", "x,y"]]) {
    const table = parseCsv(file);
    const edited = applyChanges(file, setCell(table, 1, 0, value));
    const reopened = parseCsv(edited);
    assert.equal(reopened.delimiter, table.delimiter, JSON.stringify(value));
    assert.equal(reopened.columns, table.columns, JSON.stringify(value));
    assert.equal(reopened.rows[1].cells[0].value, value);
  }
  assert.equal(applyChanges("name\nbob\n", setCell(parseCsv("name\nbob\n"), 1, 0, "x;y")), 'name\n"x;y"\n');
});

test("applyChanges uses original offsets in any order", () => {
  assert.equal(applyChanges("abcdef", [{ from: 4, to: 5, insert: "X" }, { from: 1, to: 2, insert: "" }, { from: 0, to: 0, insert: ">" }]), ">acdXf");
  assert.equal(applyChanges("abc", []), "abc");
  assert.throws(() => applyChanges("abc", [{ from: 0, to: 2, insert: "" }, { from: 1, to: 3, insert: "" }]), RangeError);
});

// ---------------------------------------------------------------- edit operations

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// out must equal text everywhere except the original range [lo, hi].
function assertOutside(text, out, lo, hi) {
  assert.equal(out.slice(0, lo), text.slice(0, lo), "prefix changed");
  assert.ok(out.endsWith(text.slice(hi)), "suffix changed");
}

function reparse(out, table) {
  const next = parseCsv(out, table.delimiter);
  assertCovers(out, next);
  assert.equal(next.bom, table.bom);
  assert.equal(next.sep, table.sep);
  return next;
}

const SET_VALUES = ["X", "a,b", 'q"t', "line\nbreak", " pad ", "", "x;y", "tab\t"];

function checkAllEdits(text, delimiterOverride) {
  const table = parseCsv(text, delimiterOverride);
  const model = values(table);
  const width = Math.max(table.columns, 1);
  const delimiter = table.delimiter;

  // setCell, including one column past the end and past the end of ragged rows.
  table.rows.forEach((row, r) => {
    for (let c = 0; c <= table.columns + 1; c++) {
      for (const value of SET_VALUES) {
        const changes = setCell(table, r, c, value);
        const out = applyChanges(text, changes);
        const expected = model.map(cells => [...cells]);
        while (expected[r].length <= c) expected[r].push("");
        expected[r][c] = value;
        if (c < model[r].length && model[r][c] === value) assert.deepEqual(changes, []);
        assert.deepEqual(values(reparse(out, table)), expected, `setCell(${r},${c},${JSON.stringify(value)}) on ${JSON.stringify(text)}`);
        assertOutside(text, out, row.from, row.to);
      }
    }
  });

  // insertRow at every index.
  for (let i = 0; i <= table.rows.length; i++) {
    const out = applyChanges(text, insertRow(table, text, i));
    const expected = model.map(cells => [...cells]);
    expected.splice(i, 0, Array(width).fill(""));
    const next = reparse(out, table);
    assert.deepEqual(values(next), expected, `insertRow(${i}) on ${JSON.stringify(text)}`);
    if (i < table.rows.length) assertOutside(text, out, table.rows[i].from, table.rows[i].from);
    else assert.ok(out.startsWith(text), "append must not touch the old text");
    if (table.rows.length) assert.equal(next.lineEnding === table.lineEnding || table.rows.length < 2, true);
  }

  // deleteRow at every index.
  table.rows.forEach((row, i) => {
    const changes = deleteRow(table, i);
    const out = applyChanges(text, changes);
    const expected = model.map(cells => [...cells]);
    expected.splice(i, 1);
    assert.deepEqual(values(reparse(out, table)), expected, `deleteRow(${i}) on ${JSON.stringify(text)}`);
    assertOutside(text, out, changes[0].from, changes[0].to);
  });

  // insertColumn at every index, including the end.
  for (let c = 0; c <= table.columns + 1; c++) {
    const changes = insertColumn(table, c);
    const out = applyChanges(text, changes);
    const expected = model.map(cells => (cells.length < c ? [...cells] : [...cells.slice(0, c), "", ...cells.slice(c)]));
    assert.deepEqual(values(reparse(out, table)), expected, `insertColumn(${c}) on ${JSON.stringify(text)}`);
    // Every change is a bare delimiter; nothing else moves.
    assert.ok(changes.every(ch => ch.from === ch.to && ch.insert === delimiter));
    assert.equal(out.length, text.length + changes.length * delimiter.length);
  }

  // deleteColumn at every index; rows without it are left alone.
  for (let c = 0; c <= table.columns + 1; c++) {
    const changes = deleteColumn(table, c);
    const out = applyChanges(text, changes);
    const expected = model.map(cells => (cells.length <= c ? [...cells] : cells.length === 1 ? [""] : cells.filter((_, i) => i !== c)));
    assert.deepEqual(values(reparse(out, table)), expected, `deleteColumn(${c}) on ${JSON.stringify(text)}`);
    assert.ok(changes.length <= table.rows.length);
  }
}

const CORPUS = [
  "a,b,c\n1,2,3\n",
  "a,b,c\n1,2,3",
  "a;b;c\r\n1;2;3\r\n4;5;6",
  "a\tb\tc\r1\t2\t3\r",
  "a|b|c\n1|2|3\n",
  "\ufeffname;city\r\n\"Ann, Jr.\";Vilnius\r\nBo;\"Kau\nnas\"\r\n",
  "sep=;\r\nx;y\r\n1;2\r\n",
  "sep=;\nx;y",
  "sep=;",
  "sep=;\n",
  "ragged,a\n1\n1,2,3,4\n\nlast",
  'q,"say ""hi""",z\n"",,\n',
  "single\ncolumn\nonly",
  "single\ncolumn\nonly\n",
  "",
  "\ufeff",
  "\n",
  "a,b\n\n",
  "x",
  ",,\n,,\n",
];

test("every edit operation on a fixed corpus", () => {
  for (const text of CORPUS) checkAllEdits(text);
});

test("every edit operation on random well-formed tables", () => {
  const rand = prng(20260511);
  const pool = ["a", "bb", "", "", "x y", "1,5", 'q"t', "two\nlines", " sp ", "car\rret", "|pipe|", "ž ė š", "tab\tx", "semi;colon"];
  for (let n = 0; n < 150; n++) {
    const delimiter = [",", ";", "\t", "|"][rand() * 4 | 0];
    const eol = ["\n", "\r\n", "\r"][rand() * 3 | 0];
    const rows = Array.from({ length: 1 + (rand() * 5 | 0) }, () => Array.from({ length: 1 + (rand() * 4 | 0) }, () => pool[rand() * pool.length | 0]));
    const lastBlank = rows.at(-1).length === 1 && rows.at(-1)[0] === "";
    const trailing = lastBlank || rand() < 0.5;
    let text = rows.map(cells => cells.map(v => (rand() < 0.15 ? `"${v.replaceAll('"', '""')}"` : encodeCell(v, delimiter))).join(delimiter)).join(eol) + (trailing ? eol : "");
    if (rand() < 0.2) text = `sep=${delimiter}${eol}` + text;
    if (rand() < 0.3) text = "\ufeff" + text;
    const table = parseCsv(text, delimiter);
    assert.deepEqual(values(table), rows, JSON.stringify(text));
    assertCovers(text, table);
    checkAllEdits(text, delimiter);
  }
});

test("setCell keeps untouched cells, quoting, delimiter, line endings and BOM byte-identical", () => {
  const text = '\ufeffa;"b;1";c\r\n1;"2";3\r\n';
  const table = parseCsv(text);
  assert.equal(applyChanges(text, setCell(table, 1, 2, "X")), '\ufeffa;"b;1";c\r\n1;"2";X\r\n');
  assert.equal(applyChanges(text, setCell(table, 0, 1, "plain")), '\ufeffa;plain;c\r\n1;"2";3\r\n');
  assert.equal(applyChanges(text, setCell(table, 0, 0, "x;y")), '\ufeff"x;y";"b;1";c\r\n1;"2";3\r\n');
  assert.deepEqual(setCell(table, 1, 1, "2"), [], "same value keeps the raw quoted cell");
  const ragged = parseCsv("a,b,c\n1\n");
  assert.equal(applyChanges("a,b,c\n1\n", setCell(ragged, 1, 3, "z")), "a,b,c\n1,,,z\n");
  assert.throws(() => setCell(table, 9, 0, "x"), RangeError);
});

test("insertRow follows the file's trailing newline and line ending", () => {
  const withNl = "a,b\r\nc,d\r\n";
  assert.equal(applyChanges(withNl, insertRow(parseCsv(withNl), withNl, 2)), "a,b\r\nc,d\r\n,\r\n");
  assert.equal(applyChanges(withNl, insertRow(parseCsv(withNl), withNl, 0)), ",\r\na,b\r\nc,d\r\n");
  const noNl = "a,b\nc,d";
  assert.equal(applyChanges(noNl, insertRow(parseCsv(noNl), noNl, 2)), "a,b\nc,d\n,");
  assert.equal(applyChanges(noNl, insertRow(parseCsv(noNl), noNl, 1)), "a,b\n,\nc,d");
  // Single column: a blank line is a row, so a bare terminator would add nothing.
  const one = "a";
  assert.deepEqual(values(parseCsv(applyChanges(one, insertRow(parseCsv(one), one, 1)))), [["a"], [""]]);
  const empty = parseCsv("");
  assert.equal(applyChanges("", insertRow(empty, "", 0)), "\n");
  assert.throws(() => insertRow(parseCsv("a"), "a", 2), RangeError);
});

test("deleteRow keeps the file's trailing newline style", () => {
  const noNl = "a,b\r\nc,d";
  assert.equal(applyChanges(noNl, deleteRow(parseCsv(noNl), 1)), "a,b");
  assert.equal(applyChanges(noNl, deleteRow(parseCsv(noNl), 0)), "c,d");
  const withNl = "a,b\nc,d\n";
  assert.equal(applyChanges(withNl, deleteRow(parseCsv(withNl), 1)), "a,b\n");
  assert.equal(applyChanges("a,b", deleteRow(parseCsv("a,b"), 0)), "");
  assert.equal(applyChanges("\ufeffa,b\n", deleteRow(parseCsv("\ufeffa,b\n"), 0)), "\ufeff");
});

test("column operations use the file's delimiter", () => {
  const text = "a;b\n1;2;3\n4\n";
  const table = parseCsv(text);
  assert.equal(applyChanges(text, insertColumn(table, 1)), "a;;b\n1;;2;3\n4;\n");
  assert.equal(applyChanges(text, insertColumn(table, 3)), "a;b\n1;2;3;\n4\n");
  assert.equal(applyChanges(text, deleteColumn(table, 1)), "a\n1;3\n4\n");
  assert.equal(applyChanges(text, deleteColumn(table, 2)), "a;b\n1;2\n4\n");
  assert.equal(applyChanges(text, deleteColumn(table, 0)), "b\n2;3\n\n");
  assert.equal(applyChanges('"x;y";z\n', deleteColumn(parseCsv('"x;y";z\n'), 0)), "z\n");
});

test("emptying the only cell of an unterminated last row keeps the row", () => {
  const text = "a\nb";
  const table = parseCsv(text);
  const out = applyChanges(text, setCell(table, 1, 0, ""));
  assert.deepEqual(values(parseCsv(out)), [["a"], [""]]);
  assert.deepEqual(values(parseCsv(applyChanges(text, deleteColumn(table, 0)))), [[""], [""]]);
});

test("edits at the end of an unterminated quoted cell close the quote first", () => {
  const edit = (text, make) => { const table = parseCsv(text, ","); const out = applyChanges(text, make(table, text)); return [out, values(parseCsv(out, ","))]; };
  assert.equal(parseCsv('a,"b', ",").unterminated, true);
  assert.equal(parseCsv('a,"b"', ",").unterminated, false);
  assert.equal(parseCsv('a,"b""', ",").unterminated, true, "an escaped quote at the end does not close it");
  assert.equal(parseCsv('"a"\n"b"\nc', ",").unterminated, false);
  assert.deepEqual(edit('a,"b', (t, x) => insertRow(t, x, 1)), ['a,"b"\n,', [["a", "b"], ["", ""]]]);
  assert.deepEqual(edit('a,"b\n', (t, x) => insertRow(t, x, 1)), ['a,"b\n"\n,', [["a", "b\n"], ["", ""]]], "a trailing newline inside the quote is cell text");
  assert.deepEqual(edit('"b', (t, x) => insertRow(t, x, 1)), ['"b"\n\n', [["b"], [""]]], "a one-column table needs a blank-line row");
  assert.deepEqual(edit('a,"b', t => setCell(t, 0, 2, "Z")), ['a,"b",Z', [["a", "b", "Z"]]]);
  assert.deepEqual(edit('a,"b', t => insertColumn(t, 2)), ['a,"b",', [["a", "b", ""]]]);
  assert.deepEqual(edit('a,"b\nc,d', t => insertColumn(t, 2)), ['a,"b\nc,d",', [["a", "b\nc,d", ""]]], "an unterminated quote swallows the following rows into one cell");
  assert.deepEqual(edit('x,y\n1,"b', t => insertColumn(t, 2)), ['x,y,\n1,"b",', [["x", "y", ""], ["1", "b", ""]]]);
  assert.deepEqual(edit('a,"b', t => insertColumn(t, 1)), ['a,,"b', [["a", "", "b"]]], "inserting before the cell needs no extra quote");
  assert.deepEqual(edit('a,"b', t => setCell(t, 0, 1, "Z")), ["a,Z", [["a", "Z"]]]);
  assert.deepEqual(edit('x,y\n1,"b', t => setCell(t, 0, 3, "Z")), ["x,y,,Z\n1,\"b", [["x", "y", "", "Z"], ["1", "b"]]], "rows before the unterminated one are unaffected");
});

test("performance: ~5 MB, 100k rows parse quickly", () => {
  const parts = [];
  for (let i = 0; i < 100_000; i++) parts.push(`${i};"name ${i}, ""x""";${(i % 97) / 7};2026-05-11;some longer free text value here\r\n`);
  const text = parts.join("");
  assert.ok(text.length > 5_000_000, `generated ${text.length}`);
  parseCsv(text);
  const start = performance.now();
  const table = parseCsv(text);
  const ms = performance.now() - start;
  console.log(`parsed ${(text.length / 1e6).toFixed(1)} MB, ${table.rows.length} rows in ${ms.toFixed(0)} ms`);
  assert.equal(table.rows.length, 100_000);
  assert.equal(table.delimiter, ";");
  assert.equal(table.rows[99_999].cells[1].value, 'name 99999, "x"');
  assert.ok(ms < 3000, `parse took ${ms} ms`);
  const t2 = performance.now();
  applyChanges(text, setCell(table, 50_000, 2, "edited"));
  assert.ok(performance.now() - t2 < 1000);
});
