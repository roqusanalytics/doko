const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const JSZip = require("jszip");
const { parseWorkbook, XLSX_LIMITS } = require("../electron/xlsx-parts.cjs");

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS = `xmlns="${MAIN}" xmlns:r="${REL}"`;
const worksheet = (rows, after = "") => `<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS}><sheetData>${rows}</sheetData>${after}</worksheet>`;
const cell = (ref, value, attributes = "") => `<c r="${ref}"${attributes}><v>${value}</v></c>`;
const inline = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

// Builds a workbook: `sheets` are { name, xml, state?, type?, target? }; `formats` lists the numFmtId of each cell
// format (index 0 is the style a cell gets without an s attribute); `codes` maps custom ids to format codes.
async function workbook({ sheets, strings, formats, codes = {}, date1904 = false, afterSheets = "", files = {} }) {
  const zip = new JSZip();
  const relationships = sheets.map(({ type = "worksheet", target }, i) =>
    `<Relationship Id="rId${i + 1}" Type="${REL}/${type}" Target="${target ?? `worksheets/sheet${i + 1}.xml`}"/>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook ${NS}><workbookPr${date1904 ? ' date1904="1"' : ""}/><sheets>${
    sheets.map(({ name, state }, i) => `<sheet name="${name}" sheetId="${i + 1}"${state ? ` state="${state}"` : ""} r:id="rId${i + 1}"/>`).join("")}</sheets>${afterSheets}</workbook>`);
  sheets.forEach(({ xml, target }, i) => { if (!target) zip.file(`xl/worksheets/sheet${i + 1}.xml`, xml ?? worksheet("")); });
  if (strings) {
    relationships.push(`<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
    zip.file("xl/sharedStrings.xml", `<sst ${NS}>${strings.map((si) => `<si>${si}</si>`).join("")}</sst>`);
  }
  if (formats) {
    relationships.push(`<Relationship Id="rIdT" Type="${REL}/styles" Target="styles.xml"/>`);
    zip.file("xl/styles.xml", `<styleSheet ${NS}><numFmts>${Object.entries(codes).map(([id, code]) =>
      `<numFmt numFmtId="${id}" formatCode="${code.replace(/"/g, "&quot;")}"/>`).join("")}</numFmts><cellXfs>${
      formats.map((id) => `<xf numFmtId="${id}"/>`).join("")}</cellXfs></styleSheet>`);
  }
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}</Relationships>`);
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const only = async (spec, limits) => (await parseWorkbook(await workbook(spec), limits)).sheets[0];

test("sheets keep workbook order and names; hidden sheets are included; chart sheets are skipped", async () => {
  const bytes = await workbook({ sheets: [
    { name: "Second &amp; last", xml: worksheet(inline("A1", "b")) },
    { name: "Chart", type: "chartsheet", target: "chartsheets/sheet1.xml" },
    { name: "Hidden", state: "hidden", xml: worksheet(inline("A1", "secret")) },
    { name: "Empty" },
  ], files: { "xl/chartsheets/sheet1.xml": `<chartsheet ${NS}/>` } });
  assert.deepEqual(await parseWorkbook(bytes), { truncated: false, sheets: [
    { name: "Second & last", rows: [["b"]], truncated: false },
    { name: "Hidden", rows: [["secret"]], truncated: false },
    { name: "Empty", rows: [], truncated: false },
  ] });
});

test("shared, rich-text, inline and formula strings, with phonetic runs ignored and escapes decoded", async () => {
  const sheet = await only({
    strings: ["<t>plain</t>", "<r><t>Rich </t></r><r><rPr><b/></rPr><t>text</t></r>", "<t>漢字</t><rPh sb=\"0\" eb=\"2\"><t>かんじ</t></rPh><phoneticPr fontId=\"1\"/>",
      "<t>a &amp; b &lt;c&gt; &#65;&#x42;</t>", "<t>line_x000D_break _x005F_x0041_</t>"],
    sheets: [{ name: "S", xml: worksheet(
      `<row r="1">${cell("A1", 0, ' t="s"')}${cell("B1", 1, ' t="s"')}${cell("C1", 2, ' t="s"')}${cell("D1", 3, ' t="s"')}${cell("E1", 4, ' t="s"')}${cell("F1", 99, ' t="s"')}</row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><r><t>in</t></r><r><t>line</t></r><rPh><t>x</t></rPh></is></c>` +
      `<c r="B2" t="str"><f>A1&amp;"!"</f><v>plain!</v></c><c r="C2"><f>1+1</f></c><c r="D2" t="inlineStr"><is><t xml:space="preserve"> kept </t></is></c></row>`) }],
  });
  assert.deepEqual(sheet.rows, [
    ["plain", "Rich text", "漢字", "a & b <c> AB", "line\rbreak _x0041_"],
    ["inline", "plain!", "", " kept "],
  ]);
});

test("numbers lose float noise; booleans, errors and cached formula values show as text", async () => {
  const sheet = await only({ sheets: [{ name: "S", xml: worksheet(`<row r="1">${cell("A1", "0.30000000000000004")}${cell("B1", 100)}${cell("C1", "1E-3")}${cell("D1", "-0")}${cell("E1", "123456789.123456789")}${cell("F1", "abc")}</row>` +
    `<row r="2">${cell("A2", 1, ' t="b"')}${cell("B2", 0, ' t="b"')}${cell("C2", "#DIV/0!", ' t="e"')}<c r="D2"><f>SUM(A1:B1)</f><v>100.30000000000001</v></c></row>`) }] });
  assert.deepEqual(sheet.rows, [["0.3", "100", "0.001", "0", "123456789.123457", "abc"], ["TRUE", "FALSE", "#DIV/0!", "100.3"]]);
});

test("dates: 1900 system with Excel's leap-year bug, 1904 system, date-time, time-only, custom and elapsed formats", async () => {
  const codes = { 164: "yyyy\\-mm\\-dd", 165: "dd/mm/yyyy hh:mm", 166: "[$-409]mmmm d, yyyy;@", 167: "[h]:mm:ss", 168: "h:mm AM/PM", 169: "mmm" };
  const formats = [0, 14, 22, 21, 164, 165, 166, 167, 168, 169];
  const row = (...cells) => `<row r="1">${cells.map(([ref, value, style]) => cell(ref, value, ` s="${style}"`)).join("")}</row>`;
  const rows = [
    row(["A1", 44927, 1], ["B1", 44927.5, 2], ["C1", 0.5, 3], ["D1", 44927, 4], ["E1", 44927.75, 5], ["F1", 44927, 6], ["G1", 1.5, 7], ["H1", 0.75, 8], ["I1", 44927, 9]),
    `<row r="2">${[[1, 1], [59, 1], [60, 1], [61, 1], [0, 1], [0.999999, 3], [-5, 1], [3000000, 1]].map(([value, style], i) => cell(`${"ABCDEFGH"[i]}2`, value, ` s="${style}"`)).join("")}</row>`,
  ].join("");
  const sheet = await only({ formats, codes, sheets: [{ name: "S", xml: worksheet(rows) }] });
  assert.deepEqual(sheet.rows, [
    ["2023-01-01", "2023-01-01 12:00:00", "12:00:00", "2023-01-01", "2023-01-01 18:00:00", "2023-01-01", "36:00:00", "18:00:00", "2023-01-01"],
    ["1900-01-01", "1900-02-28", "1900-02-29", "1900-03-01", "1900-01-00", "00:00:00", "-5", "3000000"],
  ]);

  const in1904 = await only({ date1904: true, formats, codes, sheets: [{ name: "S", xml: worksheet(
    `<row r="1">${cell("A1", 43465, ' s="1"')}${cell("B1", 0, ' s="1"')}${cell("C1", 43465.25, ' s="2"')}</row>`) }] });
  assert.deepEqual(in1904.rows, [["2023-01-01", "1904-01-01", "2023-01-01 06:00:00"]]);
});

test("an extension's prefixed workbookPr does not reset the 1904 date system", async () => {
  const afterSheets = `<extLst><ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB5}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:workbookPr chartTrackingRefBase="1"/></ext></extLst>`;
  const sheet = await only({ date1904: true, afterSheets, formats: [0, 14], sheets: [{ name: "S", xml: worksheet(`<row r="1">${cell("A1", 43465, ' s="1"')}</row>`) }] });
  assert.deepEqual(sheet.rows, [["2023-01-01"]]);
});

test("a number format with a quoted literal or color tag is not a date", async () => {
  const codes = { 164: '0.00 "days"', 165: '#,##0 "yd" "mm"', 166: "[Red]0.0", 167: '[$USD] #,##0.00', 168: "0.00E+00", 169: "General", 170: "0 \\d" };
  const sheet = await only({ formats: [0, 164, 165, 166, 167, 168, 169, 170], codes, sheets: [{ name: "S", xml: worksheet(
    `<row r="1">${[1, 2, 3, 4, 5, 6, 7].map((style, i) => cell(`${"ABCDEFG"[i]}1`, 44927, ` s="${style}"`)).join("")}</row>`) }] });
  assert.deepEqual(sheet.rows, [Array(7).fill("44927")]);
});

test("cells are placed by reference; sparse rows and columns become empty strings; a merged cell keeps its top-left value", async () => {
  const sheet = await only({ sheets: [{ name: "S", xml: worksheet(
    `<row r="2">${inline("C2", "x")}<c r="D2" s="1"/></row>` +
    `<row r="4">${inline("E4", "y")}${inline("A4", "z")}</row>` +
    `<row r="6">${inline("A6", "merged")}<c r="B6"/><c r="C6"/></row>` +
    `<row>${cell("A7", 1)}<c><v>2</v></c><c><v>3</v></c></row>` +
    `<row><c><v>0</v></c></row>` +
    `<row r="9"><c><v>8</v></c><c r="C9"><v>9</v></c><c><v>10</v></c></row>`,
  `<mergeCells count="1"><mergeCell ref="A6:C6"/></mergeCells>`) }] });
  assert.deepEqual(sheet.rows, [[], ["", "", "x"], [], ["z", "", "", "", "y"], [], ["merged"], ["1", "2", "3"], ["0"], ["8", "", "9", "10"]]);
});

test("prefixed element names and relationship targets: absolute and relative are read, external ones are never followed", async () => {
  const bytes = await workbook({ sheets: [
    { name: "Absolute", target: "/xl/worksheets/prefixed.xml" },
    { name: "Remote", target: "https://example.com/sheet.xml" },
    { name: "Dots", target: "worksheets/../worksheets/dots.xml" },
  ], files: {
    "xl/worksheets/prefixed.xml": `<x:worksheet xmlns:x="${MAIN}"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>ok</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`,
    "xl/worksheets/dots.xml": worksheet(inline("A1", "dots")),
  } });
  const zip = await JSZip.loadAsync(bytes);
  zip.file("xl/_rels/workbook.xml.rels", (await zip.file("xl/_rels/workbook.xml.rels").async("string")).replace('Target="https://example.com/sheet.xml"', 'Target="https://example.com/sheet.xml" TargetMode="External"'));
  const result = await parseWorkbook(await zip.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(result.sheets.map(({ name, rows }) => [name, rows]), [["Absolute", [["ok"]]], ["Dots", [["dots"]]]]);
});

test("limits: cells per sheet, cells overall, sheets, and padding for a far-away cell set truncated", async () => {
  const row = `<row r="1">${"ABCDEFGHIJ".split("").map((letter) => inline(`${letter}1`, letter)).join("")}</row>`;
  const spec = { sheets: [{ name: "One", xml: worksheet(row) }, { name: "Two", xml: worksheet(row) }] };
  const bytes = await workbook(spec);

  const perSheet = await parseWorkbook(bytes, { ...XLSX_LIMITS, sheetCells: 5 });
  assert.deepEqual(perSheet.sheets[0], { name: "One", rows: [["A", "B", "C", "D"]], truncated: true });
  assert.equal(perSheet.truncated, true);

  const overall = await parseWorkbook(bytes, { ...XLSX_LIMITS, totalCells: 11 });
  assert.deepEqual(overall.sheets.map(({ rows, truncated }) => [rows.length && rows[0].length, truncated]), [[10, false], [0, true]]);
  assert.equal(overall.truncated, true);

  const characters = await parseWorkbook(bytes, { ...XLSX_LIMITS, totalChars: 3 });
  assert.deepEqual(characters.sheets[0].rows, [["A", "B", "C"]]);
  assert.equal(characters.truncated, true);

  const sheets = await parseWorkbook(bytes, { ...XLSX_LIMITS, sheets: 1 });
  assert.deepEqual([sheets.sheets.length, sheets.truncated], [1, true]);

  const far = await only({ sheets: [{ name: "S", xml: worksheet(inline("XFD1048576", "far")) }] });
  assert.deepEqual([far.rows, far.truncated], [[], true]);

  const whole = await parseWorkbook(bytes);
  assert.equal(whole.truncated, false);
  assert.equal(await only({ sheets: [{ name: "S", xml: worksheet(inline("XFD1", "edge")) }] }).then(({ rows }) => rows[0].length), 16384);
});

test("a cell is cut at Excel's own character limit", async () => {
  const sheet = await only({ sheets: [{ name: "S", xml: worksheet(inline("A1", "x".repeat(40000))) }] });
  assert.equal(sheet.rows[0][0].length, XLSX_LIMITS.cellChars);
});

test("references outside Excel's limits are rejected", async () => {
  for (const ref of ["XFE1", "A1048577", "A0", "1A", "AAAA1"]) {
    await assert.rejects(only({ sheets: [{ name: "S", xml: worksheet(inline(ref, "x")) }] }), (error) => /outside Excel's limits/.test(error.message) && /valid \.xlsx/.test(error.userMessage), ref);
  }
  await assert.rejects(only({ sheets: [{ name: "S", xml: worksheet(`<row r="1048577"/>`) }] }), /outside Excel's limits/);
});

test("a part over the size limit is rejected before it is read", async () => {
  const bytes = await workbook({ sheets: [{ name: "S", xml: worksheet(inline("A1", "x".repeat(5000))) }] });
  await assert.rejects(parseWorkbook(bytes, { ...XLSX_LIMITS, part: 2000 }), (error) => /conversion limits/.test(error.message) && error.userMessage === "It's too large to convert.");
  await assert.rejects(parseWorkbook(bytes, { ...XLSX_LIMITS, total: 3000 }), /conversion limits/);
});

test("a relationship target that escapes the archive is rejected", async () => {
  for (const target of ["../../evil.xml", "/../evil.xml", "..\\..\\evil.xml", "worksheets/../../../evil.xml"]) {
    const bytes = await workbook({ sheets: [{ name: "S", target }], files: { "evil.xml": worksheet(inline("A1", "escaped")) } });
    await assert.rejects(parseWorkbook(bytes), (error) => /escapes the archive/.test(error.message) && /valid \.xlsx/.test(error.userMessage), target);
  }
});

test("a DOCTYPE with an external entity is rejected, not resolved", async () => {
  const doctype = '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY secret SYSTEM "file:///etc/passwd">]>';
  const bytes = await workbook({ strings: ["<t>x</t>"], sheets: [{ name: "S" }], files: { "xl/sharedStrings.xml": `${doctype}<sst ${NS}><si><t>&secret;</t></si></sst>` } });
  await assert.rejects(parseWorkbook(bytes), (error) => /Malformed XML/.test(error.message) && /valid \.xlsx/.test(error.userMessage));
});

test("files that are not workbooks fail with a message the user can act on", async () => {
  const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const message = async (bytes) => parseWorkbook(bytes).then(() => assert.fail("opened"), (error) => error.userMessage);
  assert.match(await message(Buffer.from("just text")), /valid \.xlsx/);
  assert.match(await message(Buffer.alloc(0)), /valid \.xlsx/);
  assert.match(await message(Buffer.concat([OLE, Buffer.alloc(512)])), /^Old \.xls files aren't supported\. Save it as \.xlsx/);
  assert.match(await message(Buffer.concat([OLE, Buffer.alloc(512), Buffer.from("EncryptedPackage", "utf16le")])), /^This workbook is password-protected/);
  const docx = new JSZip();
  docx.file("word/document.xml", "<w:document/>");
  assert.match(await message(await docx.generateAsync({ type: "nodebuffer" })), /valid \.xlsx/);
  const truncated = (await workbook({ sheets: [{ name: "S" }] })).subarray(0, 100);
  assert.match(await message(truncated), /valid \.xlsx/);
});

test("the worker reads the staged file and writes the tables as JSON, and reports failures with their userMessage", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-xlsx-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // Stands in for Electron's utility-process port: one message in, one message out.
  const harness = `
    const { EventEmitter } = require("node:events");
    const port = new EventEmitter();
    port.postMessage = (message) => { process.stdout.write(JSON.stringify(message)); process.exit(0); };
    process.parentPort = port;
    require(process.argv[1]);
    port.emit("message", { data: { source: process.argv[2], output: process.argv[3] } });
  `;
  const run = (source, output) => JSON.parse(execFileSync(process.execPath, ["-e", harness, require.resolve("../electron/xlsx-worker.cjs"), source, output], { timeout: 20000, encoding: "utf8" }));

  const good = path.join(dir, "good.xlsx"), goodOutput = path.join(dir, "good.json");
  const bytes = await workbook({ sheets: [{ name: "Data", xml: worksheet(inline("B2", "hi")) }] });
  await fs.writeFile(good, bytes);
  assert.deepEqual(run(good, goodOutput), {});
  assert.deepEqual(JSON.parse(await fs.readFile(goodOutput, "utf8")), await parseWorkbook(bytes));
  if (process.platform !== "win32") assert.equal((await fs.stat(goodOutput)).mode & 0o777, 0o600);

  const old = path.join(dir, "old.xls");
  await fs.writeFile(old, Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]));
  const failure = run(old, path.join(dir, "old.json"));
  assert.match(failure.userMessage, /^Old \.xls files/);
  assert.match(failure.error, /Legacy \.xls/);
  await assert.rejects(fs.stat(path.join(dir, "old.json")), { code: "ENOENT" });
});

// Hostile input must finish quickly: it either parses or fails with the normal invalid-workbook error, never hangs.
async function finishesQuickly(bytes, limits) {
  const start = Date.now();
  const outcome = await parseWorkbook(bytes, limits).then((result) => ({ result }), (error) => ({ error }));
  assert.ok(Date.now() - start < 2000, `took ${Date.now() - start} ms`);
  if (outcome.error) assert.match(outcome.error.userMessage, /valid \.xlsx/);
  return outcome;
}

test("a long attribute-like run in a tag is scanned in linear time", async () => {
  const xml = worksheet(`<row r="1"><c r="A1" ${"a".repeat(300_000)}><v>1</v></c></row>`);
  const { result } = await finishesQuickly(await workbook({ sheets: [{ name: "S", xml }] }));
  assert.deepEqual(result.sheets[0].rows, [["1"]]);
});

test("a long unclosed tag name is rejected in linear time", async () => {
  for (const hostile of ["<" + "a".repeat(200_000), "<c " + "a".repeat(200_000), `<c a="${"a".repeat(200_000)}`]) {
    const { error } = await finishesQuickly(await workbook({ sheets: [{ name: "S", xml: `<worksheet ${NS}><sheetData>${hostile}` }] })); // never closed, so the tag can't end
    assert.match(error.message, /Malformed XML/);
  }
});

test("number formats with huge or bracket-heavy codes are classified once and in linear time", async () => {
  const many = (code, count) => workbook({ formats: Array(count).fill(164), codes: { 164: code }, sheets: [{ name: "S", xml: worksheet(`<row r="1">${cell("A1", 44927, ' s="1"')}</row>`) }] });
  for (const [code, count] of [["[".repeat(1_000_000), 20_000], ["[".repeat(20_000), 50]]) {
    const { result } = await finishesQuickly(await many(code, count));
    assert.deepEqual(result.sheets[0].rows, [["44927"]]);
  }
  assert.deepEqual((await only({ formats: [0, 164, 164], codes: { 164: "[Red]yyyy-mm-dd" }, sheets: [{ name: "S", xml: worksheet(`<row r="1">${cell("A1", 44927, ' s="1"')}${cell("B1", 44927, ' s="2"')}</row>`) }] })).rows, [["2023-01-01", "2023-01-01"]]);
});

test("worksheets that share one large part are charged for every scan", async () => {
  const part = worksheet("<row/>".repeat(500_000)); // about 3 MB with no value cells, so the cell budgets never run down
  const names = Array.from({ length: 256 }, (_, i) => ({ name: `S${i}`, target: "worksheets/shared.xml" }));
  const bytes = await workbook({ sheets: names, files: { "xl/worksheets/shared.xml": part } });
  const { result } = await finishesQuickly(bytes, { ...XLSX_LIMITS, part: 4 * 1024 ** 2, total: 8 * 1024 ** 2 });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.sheets.map(({ truncated }) => truncated).slice(0, 3), [false, false, true]);
  assert.ok(result.sheets.slice(2).every(({ truncated, rows }) => truncated && rows.length === 0));
});
