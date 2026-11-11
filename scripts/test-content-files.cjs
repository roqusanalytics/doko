const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
if (process.platform === 'win32') {
  // Keep native diagnostics for disposable fixtures; the app returns a short, user-facing error.
  const child = require('node:child_process'), execFile = child.execFile;
  child.execFile = (file, args, options, callback) => execFile(file, args, options, (error, stdout, stderr) => {
    if (error) console.error('Native save fixture command failed:', stderr || error.message);
    callback(error, stdout, stderr);
  });
}
const { createContentFiles, imageInfo, MAX_MARKDOWN_BYTES, MAX_IMAGE_BYTES } = require("../electron/content-files.cjs");

function png(width = 2, height = 3) {
  const data = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(13, 8); data.write("IHDR", 12); data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20);
  return data;
}
function box(type, body) {
  const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4);
  return Buffer.concat([header, body]);
}
function formats() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 3, 0, 2, 1]);
  const gif = Buffer.from("47494638396102000300000000", "hex");
  const bmp = Buffer.alloc(54); bmp.write("BM"); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(2, 18); bmp.writeInt32LE(-3, 22);
  const webp = Buffer.alloc(30); webp.write("RIFF"); webp.write("WEBPVP8X", 8); webp.writeUIntLE(1, 24, 3); webp.writeUIntLE(2, 27, 3);
  const ispe = Buffer.alloc(12); ispe.writeUInt32BE(2, 4); ispe.writeUInt32BE(3, 8);
  const avif = Buffer.concat([box("ftyp", Buffer.from("avif\0\0\0\0avif")), box("meta", Buffer.concat([Buffer.alloc(4), box("iprp", box("ipco", box("ispe", ispe)))]))]);
  for (const [name, data] of [["a.png", png()], ["a.jpg", jpeg], ["a.jpeg", jpeg], ["a.gif", gif], ["a.bmp", bmp], ["a.webp", webp], ["a.avif", avif]]) {
    assert.deepEqual([imageInfo(data, name).width, imageInfo(data, name).height], [2, 3], name);
    assert.throws(() => imageInfo(data.subarray(0, 4), name), /damaged/);
  }
  assert.throws(() => imageInfo(png(10_000, 8_001), "huge.png"), /80 million/);
  assert.throws(() => imageInfo(png(), "fake.jpg"), /damaged/);
}

(async () => {
  formats();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-content-"));
  try {
    const root = await fs.realpath(temp);
    let destination = null;
    const files = createContentFiles({ chooseSavePath: async () => destination });
    const file = path.join(root, "notes.md");
    const original = Buffer.from("\ufeff# Original\r\nLine two\r\n");
    await fs.writeFile(file, original, { mode: 0o640 });
    const first = await files.open(file);
    assert.equal(first.text, "# Original\nLine two\n");
    assert.equal(first.kind, "markdown");
    assert.equal((await files.open(file)).id, first.id);
    const opens = await Promise.all(Array.from({ length: 5 }, () => files.open(file)));
    assert(opens.every(doc => doc.id === first.id));
    const secondFile = path.join(root, "same.markdown");
    await fs.writeFile(secondFile, original);
    const second = await files.open(secondFile);
    assert.notEqual(first.id, second.id, "equal content in different files stays separate");

    const initialSave = await files.save(first.id, "# Edited\nText\n");
    assert.equal(initialSave.ok, true, JSON.stringify(initialSave));
    assert.equal(await fs.readFile(file, "utf8"), "\ufeff# Edited\r\nText\r\n");
    if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
    assert.equal((await files.save(first.id, "")).ok, true);
    assert.equal(await fs.readFile(file, "utf8"), "\ufeff");
    assert.equal((await files.reload(first.id)).text, "");

    await fs.writeFile(file, "external change");
    assert.equal((await files.open(file)).text, "", "reopen must not reset the external-conflict baseline");
    assert.equal((await files.save(first.id, "my unsaved edit")).conflict, true);
    assert.equal(await fs.readFile(file, "utf8"), "external change");
    assert.equal((await files.save(first.id, "my unsaved edit", true)).cancelled, true);
    assert.equal((await files.reload(first.id)).text, "external change");
    destination = secondFile;
    assert.match((await files.save(first.id, "copy", true)).error, /already open/);
    assert.equal(await fs.readFile(secondFile, "utf8"), original.toString());
    destination = file;
    assert.match((await files.save(first.id, "copy", true)).error, /different file name/);
    destination = path.join(root, "copy.md");
    const saved = await files.save(first.id, "Saved copy\n", true);
    assert.equal(saved.ok, true);
    assert.equal(saved.document.name, "copy.md");
    assert.equal(saved.document.id, first.id);
    assert.equal((await files.open(destination)).id, first.id);
    assert.equal(await fs.readFile(file, "utf8"), "external change");
    assert.equal(await fs.readFile(destination, "utf8"), "Saved copy\n");
    await fs.unlink(destination);
    assert.equal((await files.save(first.id, "deleted")).conflict, true);
    files.release(first.id);
    await assert.rejects(files.reload(first.id), /no longer open/);
    assert((await files.save(first.id, "bad")).error);

    await fs.writeFile(file, Buffer.from([0xc3, 0x28]));
    await assert.rejects(files.open(file), /UTF-8/);
    await fs.writeFile(file, "\0binary");
    await assert.rejects(files.open(file), /UTF-8/);
    await fs.writeFile(file, Buffer.alloc(MAX_MARKDOWN_BYTES + 1));
    await assert.rejects(files.open(file), /5 MB/);
    await fs.writeFile(file, "read only");
    const readonly = await files.open(file);
    await fs.chmod(file, 0o444);
    await files.reload(readonly.id);
    assert.match((await files.save(readonly.id, "lost")).error, /read-only/);
    destination = path.join(root, "readonly-copy.md");
    assert.equal((await files.save(readonly.id, "safe copy", true)).ok, true);
    assert.equal(await fs.readFile(file, "utf8"), "read only");
    assert.match((await files.save(readonly.id, "x".repeat(MAX_MARKDOWN_BYTES + 1))).error, /5 MB/);

    // Plain text: .txt reuses the Markdown record, so it only needs its own decoding, encoding and wording checks.
    assert.equal("format" in first && "encoding" in first, false, "Markdown documents carry no text marker");
    let locale = "en-US", textDestination = null, savePrompts = 0;
    const texts = createContentFiles({ getLocale: () => locale, chooseSavePath: async (name, format) => { savePrompts++; assert.equal(format, "text"); return textDestination; } });
    const note = path.join(root, "plain.txt");
    const openText = async bytes => { await fs.writeFile(note, bytes); texts.clear(); return texts.open(note); };
    const utf16 = (text, big) => { const data = Buffer.from("\ufeff" + text, "utf16le"); return big ? data.swap16() : data; };
    let doc = await openText("Plain\nnotes\n");
    assert.deepEqual([doc.kind, doc.format, doc.encoding, doc.text], ["markdown", "text", "UTF-8", "Plain\nnotes\n"]);
    assert.equal((await texts.save(doc.id, "Edited\n")).ok, true);
    assert.equal(await fs.readFile(note, "utf8"), "Edited\n");
    // The document carries the file's BOM and line ending (absent when default), so exported copies can keep them.
    assert.equal("bom" in doc || "eol" in doc || "cellEol" in doc, false, "default LF text without BOM adds no markers");
    doc = await openText("\ufeffa\r\nb\r\n");
    assert.deepEqual([doc.text, doc.bom, doc.eol, "cellEol" in doc], ["a\nb\n", true, "\r\n", false]);
    doc = await openText("");
    assert.deepEqual([doc.text, doc.encoding], ["", "UTF-8"], "an empty file is valid text");
    // Unchanged text must write back the exact bytes, in the encoding the file was read in.
    const allBytes = Buffer.from(Array.from({ length: 224 }, (_, i) => i + 0x20));
    const cases = [
      ["utf-8", Buffer.from("\ufeffnaïve\r\nλ ✓\r\n"), "UTF-8", "en-US", "naïve\nλ ✓\n"],
      ["utf-8 lf", Buffer.from("zażółć\n"), "UTF-8", "lt-LT", "zażółć\n"],
      ["utf-16le", utf16("naïve\r\nλ ✓\r\n"), "UTF-16 LE", "en-US", "naïve\nλ ✓\n"],
      ["utf-16be", utf16("naïve\r\nλ ✓\r\n", true), "UTF-16 BE", "en-US", "naïve\nλ ✓\n"],
      ["windows-1252", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x0d, 0x0a, 0x78]), "Windows-1252", "en-US", "café €\nx"],
      ["windows-1252 all bytes", allBytes, "Windows-1252", "de-DE", null],
      ["windows-1257", Buffer.from([0xe0, 0xfe, 0x0a, 0xf0]), "Windows-1257", "lt-LT", "ąž\nš"],
      ["windows-1257 lv", Buffer.from([0xe2, 0x0a]), "Windows-1257", "lv", "ā\n"],
      ["windows-1257 et", Buffer.from([0xf5]), "Windows-1257", "et_EE", "õ"],
      ["same bytes, English locale", Buffer.from([0xe0, 0xfe]), "Windows-1252", "en-GB", "àþ"],
    ];
    for (const [name, bytes, label, nextLocale, expected] of cases) {
      locale = nextLocale;
      doc = await openText(bytes);
      assert.equal(doc.encoding, label, name);
      if (expected !== null) assert.equal(doc.text, expected, name);
      assert.equal((await texts.save(doc.id, doc.text)).ok, true, name);
      assert((await fs.readFile(note)).equals(bytes), `${name}: unchanged text must keep its bytes`);
    }
    locale = "en-US";
    // Editing keeps the encoding, BOM and line endings.
    doc = await openText(utf16("a\r\nb", true));
    assert.equal((await texts.save(doc.id, "a\nb\nć")).ok, true);
    assert((await fs.readFile(note)).equals(utf16("a\r\nb\r\nć", true)));
    doc = await openText(Buffer.from("\ufeffa\rb", "utf8"));
    assert.equal((await texts.save(doc.id, "a\nb\nc")).ok, true);
    assert.equal(await fs.readFile(note, "utf8"), "\ufeffa\rb\rc");

    // Files that are not plain text, or that no supported encoding can read, never open.
    const notText = /isn't plain text or uses an encoding/;
    for (const [name, bytes, nextLocale] of [["NUL in UTF-8", Buffer.from("a\0b"), "en-US"], ["UTF-16 without BOM", Buffer.from("ab", "utf16le"), "en-US"],
      ["NUL in UTF-16", utf16("a\0b"), "en-US"], ["UTF-32 BOM", Buffer.from([0xff, 0xfe, 0, 0, 0x61, 0, 0, 0]), "en-US"],
      ["odd UTF-16", Buffer.from([0xff, 0xfe, 0x61]), "en-US"], ["lone surrogate", Buffer.from([0xff, 0xfe, 0x00, 0xd8]), "en-US"],
      ["byte undefined in Windows-1257", Buffer.from([0x61, 0xa1]), "lt-LT"], ["binary", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), "lt-LT"]]) {
      locale = nextLocale;
      await fs.writeFile(note, bytes); texts.clear();
      await assert.rejects(texts.open(note), notText, name);
    }
    locale = "en-US";
    await fs.writeFile(note, Buffer.alloc(MAX_MARKDOWN_BYTES + 1, 65)); texts.clear();
    await assert.rejects(texts.open(note), /Text is limited to 5 MB/);
    await fs.writeFile(note, Buffer.alloc(MAX_MARKDOWN_BYTES, 65)); texts.clear();
    assert.equal((await texts.open(note)).text.length, MAX_MARKDOWN_BYTES, "exactly 5 MB opens");

    // A character the file's encoding cannot hold refuses to write; saving as UTF-8 is an explicit second step.
    doc = await openText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const before = savePrompts;
    const refused = await texts.save(doc.id, "café ą\n");
    assert.deepEqual([refused.unencodable, refused.ok], [true, undefined]);
    assert.match(refused.error, /Windows-1252.*“ą”.*Nothing was saved/);
    assert((await fs.readFile(note)).equals(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])), "nothing is written");
    textDestination = path.join(root, "plain-copy.txt");
    assert.equal((await texts.save(doc.id, "café ą\n", true)).unencodable, true);
    assert.equal(savePrompts, before, "an unencodable Save As asks nothing and writes nothing");
    await assert.rejects(fs.stat(textDestination));
    doc = await openText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const utf8 = await texts.save(doc.id, "café ą\n", false, true);
    assert.deepEqual([utf8.ok, utf8.document.encoding, utf8.document.format], [true, "UTF-8", "text"]);
    assert.equal(await fs.readFile(note, "utf8"), "café ą\n");
    assert.equal((await texts.save(doc.id, "café ą ž\n")).ok, true, "the record stays UTF-8 afterwards");
    assert.equal(await fs.readFile(note, "utf8"), "café ą ž\n");
    assert.deepEqual([(await texts.reload(doc.id)).encoding, (await texts.reload(doc.id)).text], ["UTF-8", "café ą ž\n"]);
    assert.equal((await texts.save(doc.id, "x\0y")).error, "Text can't contain null characters.");
    assert.match((await texts.save(doc.id, "x".repeat(MAX_MARKDOWN_BYTES + 1))).error, /Text is limited to 5 MB/);

    // Save As keeps the encoding, asks for a .txt file, and shares the Markdown conflict checks.
    locale = "lt-LT";
    doc = await openText(Buffer.from([0xe0, 0xfe, 0x0a]));
    textDestination = path.join(root, "plain-copy.md");
    assert.match((await texts.save(doc.id, "ąž\n", true)).error, /\.txt extension/);
    textDestination = path.join(root, "plain-copy.txt");
    const copied = await texts.save(doc.id, "ąž!\n", true);
    assert.deepEqual([copied.ok, copied.document.name, copied.document.encoding], [true, "plain-copy.txt", "Windows-1257"]);
    assert((await fs.readFile(textDestination)).equals(Buffer.from([0xe0, 0xfe, 0x21, 0x0a])));
    await fs.writeFile(textDestination, "changed outside");
    assert.equal((await texts.save(doc.id, "mine")).conflict, true);
    await fs.rm(textDestination);
    locale = "en-US";
    texts.clear();
    await assert.rejects(texts.open(path.join(root, "plain.rtf")), /Markdown file, text file, CSV file, SVG file, or supported image/);

    // CSV: the same record and encodings as text, with its own format marker, wording and file filter.
    let csvDestination = null, csvPrompts = [];
    const csvs = createContentFiles({ getLocale: () => "lt-LT", chooseSavePath: async (name, format) => { csvPrompts.push(format); return csvDestination; } });
    const sheet = path.join(root, "table.csv");
    const openCsv = async bytes => { await fs.writeFile(sheet, bytes); csvs.clear(); return csvs.open(sheet); };
    doc = await openCsv("\ufeffVardas;Miestas\r\nŽygimantas;\"Šiauliai; centras\"\r\n");
    assert.deepEqual([doc.kind, doc.format, doc.encoding, doc.text], ["markdown", "csv", "UTF-8", "Vardas;Miestas\nŽygimantas;\"Šiauliai; centras\"\n"]);
    assert.deepEqual([doc.bom, doc.eol, "cellEol" in doc], [true, "\r\n", false], "CSV document carries its BOM and row ending");
    doc = await openCsv("a,\"x\r\ny\"\r\n");
    assert.deepEqual([doc.bom, doc.eol, doc.cellEol], [undefined, "\r\n", "\r\n"]);
    doc = await openCsv("\ufeffVardas;Miestas\r\nŽygimantas;\"Šiauliai; centras\"\r\n");
    assert.equal((await csvs.save(doc.id, doc.text)).ok, true);
    assert((await fs.readFile(sheet)).equals(Buffer.from("\ufeffVardas;Miestas\r\nŽygimantas;\"Šiauliai; centras\"\r\n")), "unchanged CSV keeps BOM, CRLF and quotes byte for byte");
    assert.equal((await csvs.save(doc.id, "Vardas;Miestas\nŽygimantas;Kaunas\n")).ok, true);
    assert.equal(await fs.readFile(sheet, "utf8"), "\ufeffVardas;Miestas\r\nŽygimantas;Kaunas\r\n");
    doc = await openCsv(Buffer.from([0xde, 0x3b, 0xe0, 0x0a]));
    assert.deepEqual([doc.encoding, doc.text], ["Windows-1257", "Ž;ą\n"], "legacy CSV uses the locale's single-byte page");
    const refusedCsv = await csvs.save(doc.id, "Ž;ą;ы\n");
    assert.deepEqual([refusedCsv.unencodable, refusedCsv.ok], [true, undefined]);
    assert.match(refusedCsv.error, /Windows-1257.*“ы”.*Nothing was saved/);
    assert.equal((await csvs.save(doc.id, "Ž;ą;ы\n", false, true)).document.encoding, "UTF-8");
    assert.equal((await csvs.save(doc.id, "a\0b")).error, "CSV can't contain null characters.");
    assert.match((await csvs.save(doc.id, "x".repeat(MAX_MARKDOWN_BYTES + 1))).error, /CSV is limited to 5 MB/);
    // Row terminators and line breaks inside quoted cells keep their own endings (same vectors as test-content-source.mjs).
    for (const { name, raw, from, to } of JSON.parse(await fs.readFile(path.join(__dirname, "csv-line-endings.json"), "utf8"))) {
      doc = await openCsv(raw);
      assert.equal((await csvs.save(doc.id, doc.text)).ok, true, name);
      assert.equal(await fs.readFile(sheet, "utf8"), raw, `${name}: unchanged`);
      assert.equal((await csvs.save(doc.id, doc.text.replace(from, to))).ok, true, name);
      assert.equal(await fs.readFile(sheet, "utf8"), raw.replace(from, to), `${name}: edited`);
    }
    doc = await openCsv("a,b\r\n1,2\r\n3,4\n");
    await csvs.save(doc.id, doc.text);
    assert.equal(await fs.readFile(sheet, "utf8"), "a,b\r\n1,2\r\n3,4\r\n", "mixed row endings normalize to the dominant one");
    doc = await openCsv("a,\"x\r\ny\"\n");
    await csvs.save(doc.id, doc.text + "1,2\n");
    assert.equal(await fs.readFile(sheet, "utf8"), "a,\"x\r\ny\"\n1,2\n", "a new row follows the file's row ending, not its in-cell one");
    doc = await openCsv("a,b\r\n");
    await csvs.save(doc.id, "a,\"x\ny\"\r\n");
    assert.equal(await fs.readFile(sheet, "utf8"), "a,\"x\ny\"\r\n", "a first in-cell break is LF, as Excel writes it");
    doc = await openCsv("");
    assert.deepEqual([doc.text, doc.format], ["", "csv"], "an empty CSV opens");
    await assert.rejects(openCsv(Buffer.from("a;b\0")), /isn't plain text or uses an encoding/);
    await fs.writeFile(sheet, Buffer.alloc(MAX_MARKDOWN_BYTES + 1, 65)); csvs.clear();
    await assert.rejects(csvs.open(sheet), /CSV is limited to 5 MB/);
    doc = await openCsv("a,b\n");
    csvDestination = path.join(root, "copy.txt");
    assert.match((await csvs.save(doc.id, "a,b\n", true)).error, /\.csv extension/);
    csvDestination = path.join(root, "copy.csv");
    const csvCopy = await csvs.save(doc.id, "a,b\n1,2\n", true);
    assert.deepEqual([csvCopy.ok, csvCopy.document.name, csvCopy.document.format], [true, "copy.csv", "csv"]);
    assert.deepEqual(csvPrompts, ["csv", "csv"], "Save As asks for the CSV file filter");
    csvs.clear();

    // SVG: the same record and encodings as text, with its own format marker, wording and file filter. It is not a gallery image.
    let svgDestination = null; const svgPrompts = [];
    const svgs = createContentFiles({ getLocale: () => "lt-LT", chooseSavePath: async (name, format) => { svgPrompts.push(format); return svgDestination; } });
    const drawing = path.join(root, "Drawing.SVG");
    const openSvg = async bytes => { await fs.writeFile(drawing, bytes); svgs.clear(); return svgs.open(drawing); };
    const markup = '<?xml version="1.0"?>\r\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><title>Žaliuzė</title></svg>\r\n';
    doc = await openSvg(markup);
    assert.deepEqual([doc.kind, doc.format, doc.encoding, doc.name, doc.eol], ["markdown", "svg", "UTF-8", "Drawing.SVG", "\r\n"]);
    assert.equal(doc.text, markup.replaceAll("\r\n", "\n"));
    // Unchanged text writes back the same bytes in every readable encoding, BOM and line ending included.
    for (const [name, bytes] of [["utf-8", Buffer.from(markup)], ["utf-8 bom lf", Buffer.from("﻿" + markup.replaceAll("\r\n", "\n"))],
      ["utf-16le", utf16(markup)], ["utf-16be", utf16(markup, true)], ["windows-1257", Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0xe0, 0xfe, 0x0a])]]) {
      doc = await openSvg(bytes);
      assert.equal((await svgs.save(doc.id, doc.text)).ok, true, name);
      assert((await fs.readFile(drawing)).equals(bytes), `${name}: unchanged SVG keeps its bytes`);
    }
    // An edit changes only the edited characters; encoding, BOM and line endings stay.
    doc = await openSvg(utf16(markup, true));
    assert.equal((await svgs.save(doc.id, doc.text.replace('width="4"', 'width="40"'))).ok, true);
    assert((await fs.readFile(drawing)).equals(utf16(markup.replace('width="4"', 'width="40"'), true)));
    doc = await openSvg("﻿<svg/>\n");
    assert.deepEqual([doc.bom, "eol" in doc], [true, false]);
    assert.equal((await svgs.save(doc.id, "<svg/>\n<!-- x -->\n")).ok, true);
    assert.equal(await fs.readFile(drawing, "utf8"), "﻿<svg/>\n<!-- x -->\n");
    // An empty file and text that is not SVG open as text: the reader decides what it can draw.
    for (const bytes of ["", "<html><body>no</body></html>", "plain words"]) assert.equal((await openSvg(bytes)).text, bytes);
    // Unreadable bytes, an oversized file and a NUL are refused in words about SVG, or with the shared text error.
    for (const bytes of [Buffer.from("a\0b"), Buffer.from("ab", "utf16le"), Buffer.from([0xff, 0xfe, 0x61])]) {
      await fs.writeFile(drawing, bytes); svgs.clear();
      await assert.rejects(svgs.open(drawing), notText);
    }
    await fs.writeFile(drawing, Buffer.alloc(MAX_MARKDOWN_BYTES + 1, 65)); svgs.clear();
    await assert.rejects(svgs.open(drawing), /SVG is limited to 5 MB/);
    doc = await openSvg("<svg/>");
    assert.equal((await svgs.save(doc.id, "x\0y")).error, "SVG can't contain null characters.");
    assert.match((await svgs.save(doc.id, "x".repeat(MAX_MARKDOWN_BYTES + 1))).error, /SVG is limited to 5 MB/);
    // A character the file's encoding cannot hold offers Save as UTF-8, as for text.
    doc = await openSvg(Buffer.from([0x3c, 0x73, 0x3e, 0xe9]));
    const refusedSvg = await svgs.save(doc.id, "<s>é ы</s>");
    assert.deepEqual([refusedSvg.unencodable, refusedSvg.ok], [true, undefined]);
    assert.match(refusedSvg.error, /Windows-1257.*Nothing was saved/);
    assert((await fs.readFile(drawing)).equals(Buffer.from([0x3c, 0x73, 0x3e, 0xe9])), "nothing is written");
    assert.equal((await svgs.save(doc.id, "<s>é ы</s>", false, true)).document.encoding, "UTF-8");
    assert.equal(await fs.readFile(drawing, "utf8"), "<s>é ы</s>");
    // Moving an SVG to UTF-8 updates a stale XML encoding declaration (the vectors are shared with src/content-source.ts);
    // a save in the file's own encoding rewrites nothing.
    for (const { name, input, output } of JSON.parse(await fs.readFile(path.join(__dirname, "svg-xml-encoding.json"), "utf8"))) {
      if (input.includes("\ufeff")) continue;
      const bytes = Buffer.from(input + "<!--é-->", "latin1");
      doc = await openSvg(bytes);
      assert.equal((await svgs.save(doc.id, doc.text)).ok, true, name);
      assert((await fs.readFile(drawing)).equals(bytes), `${name}: a save in the file's own encoding keeps the declaration`);
      const moved = await svgs.save(doc.id, doc.text, false, true);
      assert.deepEqual([moved.ok, moved.document.encoding], [true, "UTF-8"], name);
      assert.equal(await fs.readFile(drawing, "utf8"), output + "<!--é-->", `${name}: Save as UTF-8`);
      assert.equal(moved.document.text, output + "<!--é-->", `${name}: the record holds the saved text`);
    }
    const stale = '<?xml version="1.0" encoding="UTF-16"?>\r\n<svg><title>Žaliuzė</title></svg>\r\n';
    for (const [name, bytes] of [["utf-16le", utf16(stale)], ["utf-16be", utf16(stale, true)]]) {
      doc = await openSvg(bytes);
      assert.equal((await svgs.save(doc.id, doc.text, false, true)).ok, true, name);
      assert.equal(await fs.readFile(drawing, "utf8"), "\ufeff" + stale.replace("UTF-16", "UTF-8"), `${name}: Save as UTF-8 declares UTF-8 (the BOM is kept)`);
    }
    // A file already in UTF-8 keeps even a wrong declaration on a normal save, and after Save as UTF-8 a later save keeps the new one.
    const misdeclared = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><svg><title>é</title></svg>');
    doc = await openSvg(misdeclared);
    assert.equal((await svgs.save(doc.id, doc.text + "\n")).ok, true);
    assert.equal(await fs.readFile(drawing, "utf8"), misdeclared + "\n", "a UTF-8 file's own save does not rewrite its declaration");
    doc = await openSvg(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><svg>\u00e9</svg>', "latin1"));
    const adopted = await svgs.save(doc.id, doc.text, false, true);
    assert.equal(adopted.document.text, '<?xml version="1.0" encoding="UTF-8"?><svg>é</svg>');
    assert.equal((await svgs.save(doc.id, adopted.document.text + "\n")).ok, true);
    assert.equal(await fs.readFile(drawing, "utf8"), '<?xml version="1.0" encoding="UTF-8"?><svg>é</svg>\n');
    // Save As asks for the .svg filter and extension.
    svgDestination = path.join(root, "copy.png");
    assert.match((await svgs.save(doc.id, "<svg/>", true)).error, /\.svg extension/);
    svgDestination = path.join(root, "copy.svg");
    const svgCopy = await svgs.save(doc.id, "<svg/>", true);
    assert.deepEqual([svgCopy.ok, svgCopy.document.name, svgCopy.document.format], [true, "copy.svg", "svg"]);
    assert.deepEqual(svgPrompts, ["svg", "svg"]);
    // The same file opens once: a second open returns the same record, never a gallery.
    assert.equal((await svgs.open(svgDestination)).id, svgCopy.document.id);
    svgs.clear();

    const pictures = path.join(root, "pictures"); await fs.mkdir(pictures);
    await fs.writeFile(path.join(pictures, "photo10.png"), png());
    await fs.writeFile(path.join(pictures, "photo2.png"), png());
    await fs.writeFile(path.join(pictures, "photo1.png"), png());
    await fs.writeFile(path.join(pictures, "ignored.txt"), "text");
    await fs.mkdir(path.join(pictures, "nested"));
    if (process.platform !== "win32") {
      // Outlook's macOS attachment folder: the opened file is readable, the folder can't be listed.
      const locked = path.join(root, "locked"); await fs.mkdir(locked);
      await fs.writeFile(path.join(locked, "image001.png"), png());
      await fs.writeFile(path.join(locked, "other.png"), png());
      await fs.chmod(locked, 0o300);
      try {
        const single = await files.open(path.join(locked, "image001.png"));
        assert.deepEqual([single.files, single.selected], [["image001.png"], "image001.png"]);
        assert.equal((await files.image(single.id, "image001.png")).mime, "image/png");
        assert.deepEqual((await files.refresh(single.id, "other.png")).files, ["image001.png"], "refresh can't reveal unopened files");
        await assert.rejects(files.image(single.id, "other.png"));
        files.release(single.id);
      } finally { await fs.chmod(locked, 0o700); }
    }
    const selected = path.join(pictures, "photo2.png");
    const gallery = await files.open(selected);
    assert.deepEqual(gallery.files, ["photo1.png", "photo2.png", "photo10.png"]);
    assert.equal(gallery.selected, "photo2.png");
    assert.equal((await files.open(path.join(pictures, "photo10.png"))).id, gallery.id);
    assert.equal((await files.image(gallery.id, "photo2.png")).mime, "image/png");
    for (const name of ["../notes.md", "/etc/passwd", "nested/photo.png", "photo2.png:stream", "photo2.png\\other", "ignored.txt"]) {
      await assert.rejects(files.image(gallery.id, name));
    }
    await fs.unlink(selected);
    await assert.rejects(files.image(gallery.id, "photo2.png"));
    assert.equal((await files.refresh(gallery.id, "photo10.png")).selected, "photo10.png");
    assert.equal((await files.refresh(gallery.id, "photo2.png")).selected, "photo1.png");
    await fs.writeFile(path.join(pictures, "photo1.png"), "damaged");
    await assert.rejects(files.image(gallery.id, "photo1.png"), /damaged/);
    await fs.writeFile(path.join(pictures, "photo1.png"), png(10_000, 8_001));
    await assert.rejects(files.image(gallery.id, "photo1.png"), /80 million/);
    const huge = await fs.open(path.join(pictures, "photo1.png"), "w"); await huge.truncate(MAX_IMAGE_BYTES + 1); await huge.close();
    await assert.rejects(files.image(gallery.id, "photo1.png"), /size limit/);
    await fs.writeFile(path.join(pictures, "photo1.png"), png());
    assert.equal((await files.asset(readonly.id, "pictures/photo1.png")).mime, "image/png");
    assert.equal((await files.asset(readonly.id, "./pictures/photo1.png")).mime, "image/png");
    await fs.writeFile(path.join(pictures, "photo space.png"), png());
    assert.equal((await files.asset(readonly.id, "./pictures/photo%20space.png")).mime, "image/png");
    await assert.rejects(files.asset(readonly.id, "%2e%2e/outside.png"));
    assert((await files.save(readonly.id, "binary\0text")).error);
    for (const name of ["../outside.png", "https://host/image.png", "/etc/passwd", "pictures/../notes.md", "notes.md", "pictures//photo1.png"]) {
      await assert.rejects(files.asset(readonly.id, name));
    }
    if (process.platform !== "win32") {
      await fs.symlink(path.join(pictures, "photo1.png"), path.join(pictures, "link.png"));
      await assert.rejects(files.open(path.join(pictures, "link.png")), /symbolic link/);
      assert(!(await files.refresh(gallery.id, "photo1.png")).files.includes("link.png"));
      await fs.symlink(pictures, path.join(root, "linked-folder"));
      await assert.rejects(files.asset(readonly.id, "linked-folder/photo1.png"), /Symbolic links/);
      await fs.symlink(path.join(root, "readonly-copy.md"), path.join(root, "linked.md"));
      await assert.rejects(files.open(path.join(root, "linked.md")), /symbolic link/);
      destination = path.join(root, "linked.md");
      assert((await files.save(readonly.id, "replace link", true)).error);
      assert.equal(await fs.readFile(path.join(root, "readonly-copy.md"), "utf8"), "safe copy");
    }
    assert(!(await fs.readdir(root)).some(name => name.startsWith(".folio-")), "failed saves remove temporary files");
    files.release(gallery.id);
    await assert.rejects(files.image(gallery.id, "photo1.png"), /no longer open/);
    await assert.rejects(files.open("relative.md"), /local file/);
    await assert.rejects(files.open(path.join(root, "ignored.zip")), /Markdown file, text file, CSV file, SVG file, or supported image/);
    files.clear();
    await assert.rejects(files.reload(second.id), /no longer open/);

    // A workbook is read through the injected reader and leaves no record: opening it again reads the file again.
    let reads = 0, failure;
    const book = createContentFiles({ readWorkbook: async file => { reads++; if (failure) throw failure; return { sheets: [{ name: "S", rows: [["a"]], truncated: false }], truncated: false }; } });
    for (const name of ["data.xlsx", "old.XLS"]) {
      assert.deepEqual(await book.open(path.join(root, name)), { kind: "workbook", name, sheets: [{ name: "S", rows: [["a"]], truncated: false }], truncated: false });
    }
    assert.equal(reads, 2);
    failure = Object.assign(new Error("technical"), { userMessage: "This workbook is password-protected." });
    await assert.rejects(book.open(path.join(root, "locked.xlsx")), error => error.message === "This workbook is password-protected.");
    failure = new Error("stopped (exit code 1)");
    await assert.rejects(book.open(path.join(root, "broken.xlsx")), /may be damaged/);
    await assert.rejects(book.open("relative.xlsx"), /local file/);
    await assert.rejects(files.open(path.join(root, "data.xlsx")), /unavailable/);
    console.log("Content files: Markdown, plain-text and CSV saves/conflicts/encodings, image formats/limits, gallery identity, path and symlink isolation passed.");
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
