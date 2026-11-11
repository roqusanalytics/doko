const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");
const { checkDiskPath, readRegular, sameFile } = require("./document-files.cjs");

const { createSaveTemp, copySaveTemp } = require("./save-metadata.cjs");

const MARKDOWN_FILE = /\.(md|markdown)$/i;
const TEXT_FILE = /\.txt$/i;
const CSV_FILE = /\.csv$/i;
const SVG_FILE = /\.svg$/i;
const HTML_FILE = /\.html?$/i;
// .xls is routed here too, so the reader can tell the user to save it as .xlsx.
const XLSX_FILE = /\.xlsx?$/i;
const IMAGE_FILE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 80_000_000;
const ENCODING_LABELS = { "utf-8": "UTF-8", "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", "windows-1252": "Windows-1252", "windows-1257": "Windows-1257" };
const NOT_TEXT = "This file isn't plain text or uses an encoding Doko can't read.";
// `txt`, `csv`, `svg` and `html` records are plain text for I/O (same encodings); a CSV table or an SVG image is only a view of that text.
const kindName = format => format === "text" ? "Text" : format === "csv" ? "CSV" : format === "svg" ? "SVG" : format === "html" ? "HTML" : "Markdown";
const fileFormat = file => TEXT_FILE.test(file) ? "text" : CSV_FILE.test(file) ? "csv" : SVG_FILE.test(file) ? "svg" : HTML_FILE.test(file) ? "html" : undefined;
// What a copy of each text-based format must be named: the pattern it must match and the words for the error.
const COPY_NAME = { text: [TEXT_FILE, "a .txt"], csv: [CSV_FILE, "a .csv"], svg: [SVG_FILE, "a .svg"] };
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const conflict = () => Object.assign(new Error("The file changed on disk. Reload it or save a copy."), { conflict: true });
const compareNames = (a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);

async function regular(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("Choose a local file.");
  checkDiskPath(file);
  const stat = await fsp.lstat(file);
  if (!stat.isFile()) throw new Error("Choose a regular file, not a symbolic link.");
  const resolved = await fsp.realpath(file);
  if (!sameFile(stat, await fsp.lstat(resolved))) throw new Error("The file changed while opening.");
  return resolved;
}

async function snapshot(file, name = "Markdown") {
  const before = await fsp.lstat(file, { bigint: true });
  if (before.size > MAX_MARKDOWN_BYTES) throw new Error(`${name} is limited to 5 MB.`);
  const data = await readRegular(file, MAX_MARKDOWN_BYTES);
  const after = await fsp.lstat(file, { bigint: true });
  if (!sameFile(before, after) || before.ctimeNs !== after.ctimeNs) throw conflict();
  return { data, stat: after, digest: hash(data) };
}

function decodeMarkdown(data) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new Error("Markdown must be saved as UTF-8 text."); }
  if (text.includes("\0")) throw new Error("Markdown must be a UTF-8 text file.");
  const bom = data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const eol = text.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  return { text: text.replace(/\r\n|\r/g, "\n"), bom, eol, encoding: "utf-8" };
}

// CSV line endings: rows end with `eol`, line breaks inside quoted cells use `cellEol`, each the dominant one of its kind.
// A cell break defaults to "\n" (what Excel writes); rows default to the cell ending. Mixed row endings normalize to
// the dominant one (accepted). Keep in sync with csvEndings in src/content-source.ts.
// shortcut: a quote in the middle of a cell also toggles, so malformed quotes can misclassify later breaks; upgrade if real files show it.
function csvEndings(raw) {
  const counts = [{}, {}];
  let inside = 0;
  for (const [token] of raw.matchAll(/"|\r\n|\n|\r/g)) {
    if (token === '"') inside ^= 1; else counts[inside][token] = (counts[inside][token] ?? 0) + 1;
  }
  const top = count => ["\r\n", "\n", "\r"].reduce((best, ending) => (count[ending] ?? 0) > (count[best] ?? 0) ? ending : best, "");
  const cellEol = top(counts[1]) || "\n";
  return { eol: top(counts[0]) || cellEol, cellEol };
}
// Writes the editor's "\n" back as the file's own endings. Keep in sync with csvRestore in src/content-source.ts.
function csvRestore(text, eol, cellEol) {
  let inside = false;
  return text.replace(/"|\n/g, char => char === '"' ? ((inside = !inside), char) : inside ? cellEol : eol);
}

// Plain text: UTF-8 or BOM-marked UTF-16, else the legacy single-byte page of the user's locale.
function decodeText(data, locale, csv = false) {
  const strict = (bytes, label) => {
    try { return new TextDecoder(label, { fatal: true }).decode(bytes); } catch { throw new Error(NOT_TEXT); }
  };
  let text, bom = false, encoding = "utf-8";
  const utf16 = data[0] === 0xff && data[1] === 0xfe ? "utf-16le" : data[0] === 0xfe && data[1] === 0xff ? "utf-16be" : null;
  if (utf16) {
    if (data.length % 2) throw new Error(NOT_TEXT);
    // Swap big-endian bytes ourselves so decoding does not depend on ICU's UTF-16BE support.
    const body = Buffer.from(data.subarray(2));
    text = strict(utf16 === "utf-16be" ? body.swap16() : body, "utf-16le");
    bom = true; encoding = utf16;
  } else {
    if (data.includes(0)) throw new Error(NOT_TEXT);
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      bom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
    } catch {
      encoding = /^(lt|lv|et)(?![a-z])/i.test(locale) ? "windows-1257" : "windows-1252";
      text = new TextDecoder(encoding).decode(data);
      if (text.includes("\ufffd")) throw new Error(NOT_TEXT);
    }
  }
  if (text.includes("\0")) throw new Error(NOT_TEXT);
  const endings = csv ? csvEndings(text) : { eol: text.match(/\r\n|\n|\r/)?.[0] ?? "\n" };
  return { text: text.replace(/\r\n|\r/g, "\n"), bom, ...endings, encoding };
}

// Bytes re-encoded as UTF-8 must not sit under another encoding's XML declaration: a browser would read them as mojibake.
// Only a leading <?xml ... encoding="..."?> naming a non-UTF-8 encoding changes; same regex and vectors as src/content-source.ts.
const xmlUtf8 = text => text.replace(/^(\ufeff?\s*<\?xml\s[^?]*?\bencoding\s*=\s*)(["'])(?!utf-?8\2)[^"']*\2/i, "$1$2UTF-8$2");

// The reverse of a single-byte page comes from the decoder itself, so no table is shipped.
const legacyTables = new Map();
function legacyTable(encoding) {
  let table = legacyTables.get(encoding);
  if (!table) {
    table = new Map();
    const decoder = new TextDecoder(encoding);
    for (let byte = 0; byte < 256; byte++) {
      const char = decoder.decode(Uint8Array.of(byte));
      if (char !== "\ufffd") table.set(char, byte);
    }
    legacyTables.set(encoding, table);
  }
  return table;
}

// Throws before anything is written when a character does not exist in the file's encoding.
function encodeText(text, encoding, bom) {
  if (encoding === "utf-8") return Buffer.from((bom ? "\ufeff" : "") + text, "utf8");
  if (encoding.startsWith("utf-16")) {
    const data = Buffer.from("\ufeff" + text, "utf16le");
    return encoding === "utf-16be" ? data.swap16() : data;
  }
  const table = legacyTable(encoding), data = Buffer.alloc(text.length);
  let length = 0;
  for (const char of text) {
    const byte = table.get(char);
    if (byte === undefined) throw Object.assign(new Error(`Some characters can't be saved as ${ENCODING_LABELS[encoding]}, such as “${char}”. Nothing was saved.`), { unencodable: true });
    data[length++] = byte;
  }
  return data.subarray(0, length);
}

// Inspect dimensions before handing compressed originals to Chromium's image decoder.
function imageInfo(data, name) {
  const ext = path.extname(name).toLowerCase();
  let width, height;
  const invalid = () => { throw new Error("This image is damaged or its format is unsupported."); };
  try {
    if (ext === ".png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString("ascii", 12, 16) === "IHDR") {
      width = data.readUInt32BE(16); height = data.readUInt32BE(20);
    } else if ((ext === ".jpg" || ext === ".jpeg") && data.readUInt16BE(0) === 0xffd8) {
      for (let offset = 2; offset + 3 < data.length;) {
        if (data[offset++] !== 0xff) return invalid();
        while (data[offset] === 0xff) offset++;
        const marker = data[offset++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
        const length = data.readUInt16BE(offset);
        if (length < 2 || offset + length > data.length) return invalid();
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          if (length < 8) return invalid();
          height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break;
        }
        offset += length;
      }
    } else if (ext === ".gif" && /^GIF8[79]a$/.test(data.toString("ascii", 0, 6))) {
      width = data.readUInt16LE(6); height = data.readUInt16LE(8);
    } else if (ext === ".bmp" && data.toString("ascii", 0, 2) === "BM") {
      const header = data.readUInt32LE(14);
      if (header === 12) { width = data.readUInt16LE(18); height = data.readUInt16LE(20); }
      else if (header >= 40) { width = data.readInt32LE(18); height = Math.abs(data.readInt32LE(22)); }
    } else if (ext === ".webp" && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
      const type = data.toString("ascii", 12, 16);
      if (type === "VP8X") { width = 1 + data.readUIntLE(24, 3); height = 1 + data.readUIntLE(27, 3); }
      else if (type === "VP8 " && data.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))) {
        width = data.readUInt16LE(26) & 0x3fff; height = data.readUInt16LE(28) & 0x3fff;
      } else if (type === "VP8L" && data[20] === 0x2f) {
        const bits = data.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
      }
    } else if (ext === ".avif" && data.toString("ascii", 4, 8) === "ftyp") {
      const ftypSize = data.readUInt32BE(0);
      if (ftypSize < 16 || ftypSize > data.length || ftypSize % 4) return invalid();
      let avif = /^(avif|avis)$/.test(data.toString("ascii", 8, 12));
      for (let offset = 16; !avif && offset < ftypSize; offset += 4) avif = /^(avif|avis)$/.test(data.toString("ascii", offset, offset + 4));
      if (!avif) return invalid();
      const boxes = (start, end, depth = 0) => {
        if (depth > 8) return invalid();
        for (let offset = start; offset + 8 <= end;) {
          let size = data.readUInt32BE(offset), header = 8;
          const type = data.toString("ascii", offset + 4, offset + 8);
          if (size === 1) { size = Number(data.readBigUInt64BE(offset + 8)); header = 16; }
          if (size === 0) size = end - offset;
          if (!Number.isSafeInteger(size) || size < header || offset + size > end) return invalid();
          if (type === "ispe") {
            if (size < header + 12) return invalid();
            const w = data.readUInt32BE(offset + header + 4), h = data.readUInt32BE(offset + header + 8);
            if (!w || !h || w * h > MAX_IMAGE_PIXELS) throw new Error("This image exceeds 80 million pixels.");
            if (!width || w * h > width * height) { width = w; height = h; }
          } else if (["meta", "iprp", "ipco"].includes(type)) boxes(offset + header + (type === "meta" ? 4 : 0), offset + size, depth + 1);
          offset += size;
        }
      };
      boxes(ftypSize, data.length);
    }
  } catch (error) {
    if (error.message.includes("80 million")) throw error;
    return invalid();
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return invalid();
  if (width * height > MAX_IMAGE_PIXELS) throw new Error("This image exceeds 80 million pixels.");
  return { width, height, mime: ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : `image/${ext.slice(1)}` };
}

function createContentFiles({ chooseSavePath, confirmTrash, trashItem, requestTrashAccess, showItemInFolder, readWorkbook, getLocale = () => "en" } = {}) {
  const records = new Map();
  const identities = new Map();
  const opening = new Map();
  const get = (id, kind) => {
    const record = typeof id === "string" && records.get(id);
    if (!record || kind && record.kind !== kind) throw new Error("This document is no longer open.");
    return record;
  };
  // Text, CSV and SVG documents carry their BOM and line endings (absent when default), so exported copies can keep them.
  const document = record => ({ kind: "markdown", id: record.id, name: path.basename(record.file), text: record.text,
    ...(record.format && { format: record.format, encoding: ENCODING_LABELS[record.encoding],
      ...(record.bom && { bom: true }), ...(record.eol !== "\n" && { eol: record.eol }), ...(record.cellEol && record.cellEol !== "\n" && { cellEol: record.cellEol }) }) });
  const decode = (record, data) => record.format ? decodeText(data, getLocale(), record.format === "csv") : decodeMarkdown(data);
  const remember = record => {
    record.id = crypto.randomUUID(); records.set(record.id, record); identities.set(record.key, record.id); return record;
  };
  const checkRoot = async record => {
    const stat = await fsp.lstat(record.root, { bigint: true });
    if (!stat.isDirectory() || !sameFile(stat, record.directory)) throw new Error("The document folder changed. Reopen the file.");
  };
  // `chosen` is a file the user opened; only those may be shown when the folder itself can't be listed.
  const gallery = async (record, selected, chosen) => {
    await checkRoot(record);
    const entries = await fsp.readdir(record.root, { withFileTypes: true }).catch(error => {
      // macOS app containers (e.g. Outlook attachments) allow reading the opened file but not listing its folder.
      if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    });
    if (entries) record.files = entries.filter(entry => entry.isFile() && IMAGE_FILE.test(entry.name)).map(entry => entry.name).sort(compareNames);
    else {
      if (chosen) await fsp.open(path.join(record.root, chosen), "r").then(handle => handle.close(), error => {
        if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
        throw new Error("macOS doesn't allow Doko to read this file where it is. Save it to a folder such as Downloads, then open it from there.");
      });
      const known = [...new Set([...(record.files ?? []), ...(chosen ? [chosen] : [])])];
      const present = await Promise.all(known.map(name => fsp.lstat(path.join(record.root, name)).then(stat => stat.isFile(), () => false)));
      record.files = known.filter((_, index) => present[index]).sort(compareNames);
    }
    return { kind: "gallery", id: record.id, name: path.basename(record.root), files: record.files,
      selected: record.files.includes(selected) ? selected : record.files[0] ?? "" };
  };
  const loadMarkdown = async record => {
    await checkRoot(record);
    const source = await snapshot(record.file, kindName(record.format));
    Object.assign(record, decode(record, source.data), { source });
    return document(record);
  };
  // A workbook is a read-only snapshot: nothing stays registered, so opening it again shows the file as it is now.
  async function openWorkbook(file) {
    if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("Choose a local file.");
    if (!readWorkbook) throw new Error("Opening Excel workbooks is unavailable.");
    const result = await readWorkbook(file).catch(error => { throw new Error(error.userMessage ?? "The workbook may be damaged or too complex to open."); });
    return { kind: "workbook", name: path.basename(file), ...result };
  }
  async function open(file) {
    if (XLSX_FILE.test(file)) return openWorkbook(file);
    if (!MARKDOWN_FILE.test(file) && !fileFormat(file) && !IMAGE_FILE.test(file)) throw new Error("Choose a Markdown file, text file, CSV file, SVG file, HTML file, or supported image.");
    const resolved = await regular(file);
    const root = path.dirname(resolved), markdown = MARKDOWN_FILE.test(resolved) || !!fileFormat(resolved);
    const key = `${markdown ? "markdown" : "gallery"}:${markdown ? resolved : root}`;
    const existing = identities.get(key);
    if (existing) return markdown ? document(get(existing)) : gallery(get(existing), path.basename(resolved), path.basename(resolved));
    if (opening.has(key)) {
      const result = await opening.get(key);
      return markdown ? result : gallery(get(result.id), path.basename(resolved), path.basename(resolved));
    }
    const loading = (async () => {
      const record = { kind: markdown ? "markdown" : "gallery", format: fileFormat(resolved), file: resolved, root, key, directory: await fsp.lstat(root, { bigint: true }) };
      // Register only after a successful read, so failed opens cannot retain filesystem access.
      if (markdown) {
        const source = await snapshot(resolved, kindName(record.format));
        Object.assign(record, decode(record, source.data), { source });
        remember(record); return document(record);
      }
      const result = await gallery(record, path.basename(resolved), path.basename(resolved));
      remember(record); return { ...result, id: record.id };
    })();
    opening.set(key, loading);
    try { return await loading; } finally { opening.delete(key); }
  }
  async function asset(id, relative, galleryOnly = false) {
    const record = get(id, galleryOnly ? "gallery" : "markdown");
    if (record.format === "html") throw new Error("HTML previews cannot load local images.");
    if (!galleryOnly && typeof relative === "string") {
      try { relative = decodeURIComponent(relative).replace(/^(\.\/)+/, ""); }
      catch { throw new Error("This image path is invalid."); }
    }
    if (typeof relative !== "string" || relative.length > 4096 || !relative || relative.includes("\\") || relative.includes(":" ) || relative.includes("\0") || path.isAbsolute(relative)) throw new Error("Choose an image inside the document folder.");
    const parts = relative.split("/");
    if (parts.some(part => !part || part === "." || part === "..") || !IMAGE_FILE.test(relative)) throw new Error("Choose an image inside the document folder.");
    if (galleryOnly && (parts.length !== 1 || !record.files.includes(relative))) throw new Error("That image is not in this gallery.");
    await checkRoot(record);
    let file = record.root;
    for (let index = 0; index < parts.length; index++) {
      file = path.join(file, parts[index]);
      const stat = await fsp.lstat(file);
      if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) throw new Error("Symbolic links are not supported.");
    }
    if (await fsp.realpath(file) !== file) throw new Error("Choose an image inside the document folder.");
    const data = await readRegular(file, MAX_IMAGE_BYTES);
    return { data, mime: imageInfo(data, file).mime };
  }
  async function galleryPath(id, name) {
    const record = get(id, "gallery");
    if (typeof name !== "string" || !record.files.includes(name) || !IMAGE_FILE.test(name)
      || name.includes("/") || name.includes("\\") || name.includes(":") || name.includes("\0") || name === "." || name === "..") throw new Error("That image is not in this gallery.");
    await checkRoot(record);
    const file = path.join(record.root, name);
    if (await regular(file) !== file) throw new Error("Symbolic links are not supported.");
    return { record, file, stat: await fsp.lstat(file, { bigint: true }) };
  }
  async function trash(id, name) {
    const selected = await galleryPath(id, name);
    if (!confirmTrash || !trashItem) throw new Error("Moving to Trash is unavailable.");
    if (!await confirmTrash(name)) return null;
    const current = await galleryPath(id, name);
    if (!sameFile(selected.stat, current.stat) || selected.stat.ctimeNs !== current.stat.ctimeNs) throw new Error("The image changed. Refresh the gallery and try again.");
    try { await trashItem(current.file); }
    catch (error) {
      const denied = ["EACCES", "EPERM"].includes(error.code) || /permission|not permitted|access denied/i.test(error.message || "");
      if (!denied) throw error;
      if (!requestTrashAccess) throw new Error("Permission denied. Use Show in folder to check this file's access and lock settings, then retry.");
      const beforeAccess = hash(await readRegular(current.file, MAX_IMAGE_BYTES));
      const beforeConsent = await galleryPath(id, name);
      if (!sameFile(current.stat, beforeConsent.stat) || current.stat.ctimeNs !== beforeConsent.stat.ctimeNs) throw new Error("The image changed. Refresh the gallery and try again.");
      const chosen = await requestTrashAccess(current.file);
      if (!chosen) return null;
      if (await regular(chosen) !== current.file) throw new Error("Select the same image to allow access. No file was moved.");
      const retry = await galleryPath(id, name);
      // macOS can change access metadata during consent; compare identity and content instead of ctime.
      if (!sameFile(current.stat, retry.stat) || beforeAccess !== hash(await readRegular(retry.file, MAX_IMAGE_BYTES))) throw new Error("The image changed. Refresh the gallery and try again.");
      try { await trashItem(retry.file); }
      catch { throw new Error("Still couldn't move this image to Trash. Use Show in folder and check its access and lock settings in Finder."); }
    }
    return gallery(current.record, name);
  }
  async function reveal(id, name) {
    const record = get(id);
    let file;
    if (record.kind === "gallery" && name !== undefined) file = (await galleryPath(id, name)).file;
    else {
      await checkRoot(record);
      file = record.kind === "gallery" ? record.root : await regular(record.file);
    }
    if (!showItemInFolder) throw new Error("Showing this file is unavailable.");
    showItemInFolder(file);
    return true;
  }
  // `utf8` re-saves a text file as UTF-8 after the user accepts that its own encoding cannot hold some characters.
  async function save(id, text, copy = false, utf8 = false) {
    let record, acquired = false;
    try {
      record = get(id, "markdown");
      if (record.format === "html") throw new Error("HTML documents are read-only.");
      if (record.busy) return { error: "This document is still saving." };
      const name = kindName(record.format);
      if (typeof text !== "string" || typeof copy !== "boolean" || typeof utf8 !== "boolean") throw new Error(`Invalid ${name} save request.`);
      if (text.includes("\0")) throw new Error(record.format ? `${name} can't contain null characters.` : "Markdown must be a UTF-8 text file.");
      // Cheap bound before encoding: every supported encoding needs at least one byte per character.
      if (text.length > MAX_MARKDOWN_BYTES) throw new Error(`${name} is limited to 5 MB.`);
      const encoding = utf8 ? "utf-8" : record.encoding;
      const unified = text.replace(/\r\n|\r/g, "\n");
      // An SVG moving to UTF-8 from another encoding gets its XML declaration updated; the record then holds the rewritten text.
      const normalized = record.format === "svg" && encoding !== record.encoding ? xmlUtf8(unified) : unified;
      const data = encodeText(record.format === "csv" ? csvRestore(normalized, record.eol, record.cellEol) : normalized.replace(/\n/g, record.eol), encoding, record.bom);
      if (data.length > MAX_MARKDOWN_BYTES) throw new Error(`${name} is limited to 5 MB.`);
      record.busy = true;
      acquired = true;
      await checkRoot(record);
      let file = record.file;
      if (copy) {
        file = await chooseSavePath?.(path.basename(record.file), record.format);
        if (!file) return { cancelled: true };
        const [copyName, copyWords] = COPY_NAME[record.format] ?? [MARKDOWN_FILE, "a .md or .markdown"];
        if (!path.isAbsolute(file) || !copyName.test(file)) throw new Error(`Save the copy with ${copyWords} extension.`);
        checkDiskPath(file);
        file = path.join(await fsp.realpath(path.dirname(file)), path.basename(file));
        if (file === record.file) throw new Error("Choose a different file name to save a copy.");
        const other = identities.get(`markdown:${file}`);
        if (other && other !== record.id) throw new Error("That file is already open. Choose another name.");
      }
      let expected;
      try { expected = await snapshot(file, name); }
      catch (error) { if (!copy && error.code === "ENOENT") throw conflict(); if (!copy || error.code !== "ENOENT") throw error; }
      // Metadata may change between saves without a content edit (for example, cloud sync).
      if (!copy && (!sameFile(expected.stat, record.source.stat) || expected.digest !== record.source.digest)) throw conflict();
      if (expected && !(expected.stat.mode & 0o222n)) throw new Error("This file is read-only. Save a copy in another folder.");
      const root = path.dirname(file), directory = await fsp.lstat(root, { bigint: true });
      if (!directory.isDirectory() || !(directory.mode & 0o222n)) throw new Error("This folder is read-only. Save a copy elsewhere.");
      const pending = await createSaveTemp(root, expected && { file, stat: expected.stat });
      const { temp } = pending;
      let handle = pending.handle;
      try {
        await handle.writeFile(data); await pending.verify(); await handle.sync(); await handle.close(); handle = null;
        if (!sameFile(directory, await fsp.lstat(root, { bigint: true }))) throw conflict();
        if (expected) {
          const current = await snapshot(file, name);
          if (!sameFile(expected.stat, current.stat) || expected.digest !== current.digest || expected.stat.ctimeNs !== current.stat.ctimeNs) throw conflict();
        } else {
          try { await fsp.lstat(file); throw conflict(); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        if (expected) await fsp.rename(temp, file);
        else {
          try { await fsp.link(temp, file); }
          catch (error) {
            if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "EXDEV"].includes(error.code)) throw error;
            await copySaveTemp(temp, file);
          }
        }
      } finally { await handle?.close(); await pending.cleanup(); }
      const source = await snapshot(file, name);
      if (source.digest !== hash(data)) throw conflict();
      identities.delete(record.key);
      Object.assign(record, { file, root, directory, key: `markdown:${file}`, source, text: normalized, encoding });
      identities.set(record.key, record.id);
      return { ok: true, document: document(record) };
    } catch (error) {
      return error.conflict ? { conflict: true } : error.unencodable ? { unencodable: true, error: error.message } : { error: error.code === "EACCES" || error.code === "EPERM" || error.code === "EROFS" ? "Couldn't write this file. Save a copy in another folder." : error.message };
    } finally { if (acquired) record.busy = false; }
  }
  return { open, save, trash, reveal, asset, image: (id, name) => asset(id, name, true),
    reload: async id => loadMarkdown(get(id, "markdown")), refresh: async (id, selected) => gallery(get(id, "gallery"), selected),
    release(id) { const record = get(id); if (record.busy) throw new Error("This document is still saving."); records.delete(id); identities.delete(record.key); },
    clear() { records.clear(); identities.clear(); } };
}

module.exports = { createContentFiles, imageInfo, MARKDOWN_FILE, TEXT_FILE, CSV_FILE, SVG_FILE, HTML_FILE, XLSX_FILE, IMAGE_FILE, MAX_MARKDOWN_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS };
