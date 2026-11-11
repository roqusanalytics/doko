import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { BROWSER_ACCEPT, CONTENT_ACCEPT, csvRestore, localSources, restoreText, xmlUtf8 } from "../src/content-source.ts";

test("extensionless PDFs with no inferred MIME still reach the PDF parser", async () => {
  globalThis.window = {};
  try {
    const file = new File(["%PDF-1.7\n"], "report", { type: "" });
    const [source] = await localSources([file]);
    assert.equal(source.kind, "blob");
    assert.equal(source.blob, file);
  } finally { delete globalThis.window; }
});

test("browser edition opens .txt as UTF-8 text and rejects everything else with a clear error", async () => {
  globalThis.window = {};
  try {
    const [ok] = await localSources([new File(["ąž\r\nline"], "notes.TXT", { type: "text/plain" })]);
    assert.equal(ok.kind, "content");
    // The editor text is normalized to "\n"; the file's line ending is kept aside (changed from the raw text this test once expected).
    assert.deepEqual(ok.document, { kind: "markdown", name: "notes.TXT", text: "ąž\nline", format: "text", eol: "\r\n" });
    const [markdown] = await localSources([new File(["# Title"], "a.md")]);
    assert.equal("format" in markdown.document, false, "Markdown stays unmarked");
    const bad = [["legacy.txt", Uint8Array.of(0x63, 0x61, 0x66, 0xe9), /isn't UTF-8 text/],
      ["utf16.txt", Buffer.from("﻿ab", "utf16le"), /isn't UTF-8 text/],
      ["binary.txt", Uint8Array.of(0x61, 0, 0x62), /isn't plain text/],
      ["huge.txt", new Uint8Array(5 * 1024 * 1024 + 1), /Text files must be smaller than 5 MB/]];
    for (const [name, bytes, message] of bad) {
      const [source] = await localSources([new File([bytes], name)]);
      assert.equal(source.kind, "error", name);
      assert.match(source.message, message, name);
    }
    const [unsupported] = await localSources([new File(["x"], "data.xyz", { type: "application/x-xyz" })]);
    assert.match(unsupported.message, /PDF, Markdown document, text file, CSV file, SVG file, or image/);
  } finally { delete globalThis.window; }
});

test("browser .txt keeps its BOM and line endings aside and restores both on download and export", async () => {
  globalThis.window = {};
  try {
    for (const raw of ["\ufeffąž\r\nline\r\n", "a\r\nb\r\n", "\ufeffa\nb", "a\rb\r", "plain", ""]) {
      const [{ document }] = await localSources([new File([Buffer.from(raw)], "n.txt")]);
      assert.equal(document.text.includes("\r"), false, JSON.stringify(raw));
      assert.equal(document.bom, raw.startsWith("\ufeff") ? true : undefined, JSON.stringify(raw));
      assert.equal(restoreText(document, document.text), raw, `${JSON.stringify(raw)}: unchanged download`);
    }
    const [{ document }] = await localSources([new File([Buffer.from("\ufeffa\r\nb\r\n")], "n.txt")]);
    assert.equal(restoreText(document, document.text.replace("b", "c")), "\ufeffa\r\nc\r\n", "edited download");
    // Exported copies: CSV always gets a BOM and the file's endings; text keeps its own BOM state; Markdown is untouched.
    const [{ document: sheet }] = await localSources([new File(["a;b\r\n1;\"x\ny\"\r\n"], "s.csv")]);
    assert.equal(restoreText(sheet, sheet.text, true), "\ufeffa;b\r\n1;\"x\ny\"\r\n");
    const [{ document: plain }] = await localSources([new File(["a\r\nb"], "p.txt")]);
    assert.equal(restoreText(plain, plain.text), "a\r\nb", "no BOM stays no BOM");
    assert.equal(restoreText({}, "a\nb"), "a\nb", "Markdown text is returned as is");
  } finally { delete globalThis.window; }
});

test("browser edition opens .csv as UTF-8 with the BOM and line ending kept aside, and rejects the rest", async () => {
  globalThis.window = {};
  try {
    const bytes = Buffer.from("\ufeffVardas;Miestas\r\nŽygimantas;\"Šiauliai; centras\"\r\n");
    const [ok] = await localSources([new File([bytes], "list.CSV", { type: "text/csv" })]);
    assert.equal(ok.kind, "content");
    assert.deepEqual(ok.document, { kind: "markdown", name: "list.CSV", text: "Vardas;Miestas\nŽygimantas;\"Šiauliai; centras\"\n", format: "csv", bom: true, eol: "\r\n" });
    const [plain] = await localSources([new File(["a,b\n1,2\n"], "plain.csv")]);
    assert.deepEqual(plain.document, { kind: "markdown", name: "plain.csv", text: "a,b\n1,2\n", format: "csv" }, "no BOM and LF add no markers");
    const [empty] = await localSources([new File([], "empty.csv")]);
    assert.deepEqual(empty.document, { kind: "markdown", name: "empty.csv", text: "", format: "csv" });
    const bad = [["legacy.csv", Uint8Array.of(0x61, 0x3b, 0xe9), /isn't UTF-8 text/],
      ["binary.csv", Uint8Array.of(0x61, 0, 0x62), /isn't plain text/],
      ["huge.csv", new Uint8Array(5 * 1024 * 1024 + 1), /CSV files must be smaller than 5 MB/]];
    for (const [name, data, message] of bad) {
      const [source] = await localSources([new File([data], name)]);
      assert.equal(source.kind, "error", name);
      assert.match(source.message, message, name);
    }
    const [tsv] = await localSources([new File(["a\tb"], "data.tsv", { type: "text/tab-separated-values" })]);
    assert.equal(tsv.kind, "error", ".tsv is not routed");
  } finally { delete globalThis.window; }
});

test("browser CSV download restores row and in-cell line endings byte for byte", async () => {
  globalThis.window = {};
  try {
    // Same vectors as test-content-files.cjs. The download body is built as in ContentReader's save().
    const vectors = JSON.parse(readFileSync(new URL("./csv-line-endings.json", import.meta.url), "utf8"));
    for (const { name, raw, from, to } of vectors) {
      const [{ document }] = await localSources([new File([raw], "t.csv")]);
      const body = text => (document.bom ? "\ufeff" : "") + csvRestore(text, document.eol ?? "\n", document.cellEol ?? "\n");
      assert.equal(body(document.text), raw, `${name}: unchanged`);
      assert.equal(body(document.text.replace(from, to)), raw.replace(from, to), `${name}: edited`);
    }
    const [{ document: mixed }] = await localSources([new File(["a,b\r\n1,2\r\n3,4\n"], "m.csv")]);
    assert.equal(csvRestore(mixed.text, mixed.eol, mixed.cellEol ?? "\n"), "a,b\r\n1,2\r\n3,4\r\n", "mixed row endings normalize to the dominant one");
    const [{ document: crInCell }] = await localSources([new File(["a,\"x\r\ny\"\n"], "c.csv")]);
    assert.deepEqual([crInCell.eol, crInCell.cellEol], [undefined, "\r\n"], "LF rows with CRLF in a cell record only the cell ending");
  } finally { delete globalThis.window; }
});

test("browser edition opens .svg as UTF-8 text with the BOM and line ending kept aside, and restores them on download", async () => {
  globalThis.window = {};
  try {
    const raw = "\ufeff<?xml version=\"1.0\"?>\r\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"4\" height=\"3\"><title>Žaliuzė</title></svg>\r\n";
    const [ok] = await localSources([new File([Buffer.from(raw)], "logo.SVG", { type: "image/svg+xml" })]);
    assert.equal(ok.kind, "content", "an SVG is a content document, not a gallery image");
    assert.deepEqual(ok.document, { kind: "markdown", name: "logo.SVG", text: raw.slice(1).replaceAll("\r\n", "\n"), format: "svg", bom: true, eol: "\r\n" });
    assert.equal(restoreText(ok.document, ok.document.text), raw, "unchanged download is byte-identical");
    assert.equal(restoreText(ok.document, ok.document.text.replace('width="4"', 'width="5"')), raw.replace('width="4"', 'width="5"'), "edited download");
    const [plain] = await localSources([new File(["<svg/>\n"], "p.svg")]);
    assert.deepEqual(plain.document, { kind: "markdown", name: "p.svg", text: "<svg/>\n", format: "svg" }, "no BOM and LF add no markers");
    const [empty] = await localSources([new File([], "empty.svg")]);
    assert.deepEqual(empty.document, { kind: "markdown", name: "empty.svg", text: "", format: "svg" });
    const bad = [["legacy.svg", Uint8Array.of(0x3c, 0xe9), /isn't UTF-8 text/], ["utf16.svg", Buffer.from("\ufeff<svg/>", "utf16le"), /isn't UTF-8 text/],
      ["binary.svg", Uint8Array.of(0x61, 0, 0x62), /isn't plain text/], ["huge.svg", new Uint8Array(5 * 1024 * 1024 + 1), /SVG files must be smaller than 5 MB/]];
    for (const [name, data, message] of bad) {
      const [source] = await localSources([new File([data], name)]);
      assert.equal(source.kind, "error", name);
      assert.match(source.message, message, name);
    }
    // Raster images still go to the gallery; .svgz is not routed.
    assert.equal((await localSources([new File([new Uint8Array(4)], "a.png", { type: "image/png" })]))[0].document.kind, "gallery");
    assert.equal((await localSources([new File([new Uint8Array(4)], "a.svgz", { type: "image/svg+xml" })]))[0].kind, "error");
    for (const accept of [CONTENT_ACCEPT, BROWSER_ACCEPT]) assert.ok(accept.split(",").includes(".svg"), accept);
  } finally { delete globalThis.window; }
});

test("desktop .svg files go to the content reader and open errors show the plain message", async () => {
  const opened = [];
  globalThis.window = { folioDesktop: { content: { open: async file => { opened.push(file.name); return { kind: "markdown", name: file.name, text: "<svg/>", format: "svg" }; } } } };
  try {
    const [source] = await localSources([new File(["<svg/>"], "icon.svg")]);
    assert.deepEqual([source.kind, source.document.format, opened], ["content", "svg", ["icon.svg"]]);
    globalThis.window = { folioDesktop: { content: { open: async () => { throw new Error("Error invoking remote method 'folio:content-open': Error: SVG is limited to 5 MB."); } } } };
    const [failed] = await localSources([new File(["x"], "big.svg")]);
    assert.deepEqual([failed.kind, failed.message], ["error", "Couldn't open “big.svg”. SVG is limited to 5 MB."]);
  } finally { delete globalThis.window; }
});

test("desktop open errors for .txt and .csv show the plain message without Electron's prefix", async () => {
  const prefixed = message => new Error(`Error invoking remote method 'folio:content-open': Error: ${message}`);
  try {
    for (const [name, message] of [["binary.txt", "This file isn't plain text or uses an encoding Doko can't read."], ["huge.CSV", "CSV is limited to 5 MB."], ["gone.txt", "ENOENT: no such file or directory"]]) {
      globalThis.window = { folioDesktop: { content: { open: async () => { throw prefixed(message); } } } };
      const [source] = await localSources([new File(["x"], name)]);
      assert.deepEqual([source.kind, source.message], ["error", `Couldn't open “${name}”. ${message}`], name);
    }
  } finally { delete globalThis.window; }
});

test("Excel workbooks open on desktop only; the browser edition explains why", async () => {
  try {
    globalThis.window = { folioDesktop: {} };
    const file = new File(["PK"], "sales.XLSX", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const [desktop] = await localSources([file]);
    assert.deepEqual([desktop.kind, desktop.name, desktop.file], ["workbook", "sales.XLSX", file]);
    // .xls reaches the reader too, which tells the user to save it as .xlsx.
    assert.equal((await localSources([new File(["x"], "old.xls")]))[0].kind, "workbook");
    globalThis.window = {};
    for (const name of ["sales.xlsx", "old.xls"]) {
      const [source] = await localSources([new File(["PK"], name)]);
      assert.equal(source.kind, "error", name);
      assert.match(source.message, /Excel workbooks open in the Doko desktop app/, name);
    }
    assert.ok(CONTENT_ACCEPT.split(",").includes(".xlsx"));
    assert.deepEqual(["application/pdf", ".pdf", ".doc", ".docx", ".xlsx"].filter(type => BROWSER_ACCEPT.split(",").includes(type)), ["application/pdf", ".pdf"]);
  } finally { delete globalThis.window; }
});

test("xmlUtf8 rewrites only a leading XML declaration that names a non-UTF-8 encoding", () => {
  // Same vectors as test-content-files.cjs, which runs them through Save as UTF-8.
  for (const { name, input, output } of JSON.parse(readFileSync(new URL("./svg-xml-encoding.json", import.meta.url), "utf8"))) assert.equal(xmlUtf8(input), output, name);
});
