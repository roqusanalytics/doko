const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");
const { checkDiskPath, readRegular, sameFile } = require("./document-files.cjs");

const MARKDOWN_FILE = /\.(md|markdown)$/i;
const IMAGE_FILE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 80_000_000;
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

async function snapshot(file) {
  const before = await fsp.lstat(file, { bigint: true });
  if (before.size > MAX_MARKDOWN_BYTES) throw new Error("Markdown is limited to 5 MB.");
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
  return { text: text.replace(/\r\n|\r/g, "\n"), bom, eol };
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

function createContentFiles({ chooseSavePath } = {}) {
  const records = new Map();
  const identities = new Map();
  const opening = new Map();
  const get = (id, kind) => {
    const record = typeof id === "string" && records.get(id);
    if (!record || kind && record.kind !== kind) throw new Error("This document is no longer open.");
    return record;
  };
  const document = record => ({ kind: "markdown", id: record.id, name: path.basename(record.file), text: record.text });
  const remember = record => {
    record.id = crypto.randomUUID(); records.set(record.id, record); identities.set(record.key, record.id); return record;
  };
  const checkRoot = async record => {
    const stat = await fsp.lstat(record.root, { bigint: true });
    if (!stat.isDirectory() || !sameFile(stat, record.directory)) throw new Error("The document folder changed. Reopen the file.");
  };
  const gallery = async (record, selected) => {
    await checkRoot(record);
    record.files = (await fsp.readdir(record.root, { withFileTypes: true })).filter(entry => entry.isFile() && IMAGE_FILE.test(entry.name)).map(entry => entry.name).sort(compareNames);
    return { kind: "gallery", id: record.id, name: path.basename(record.root), files: record.files,
      selected: record.files.includes(selected) ? selected : record.files[0] ?? "" };
  };
  const loadMarkdown = async record => {
    await checkRoot(record);
    const source = await snapshot(record.file);
    Object.assign(record, decodeMarkdown(source.data), { source });
    return document(record);
  };
  async function open(file) {
    if (!MARKDOWN_FILE.test(file) && !IMAGE_FILE.test(file)) throw new Error("Choose a Markdown file or supported image.");
    const resolved = await regular(file);
    const root = path.dirname(resolved), markdown = MARKDOWN_FILE.test(resolved);
    const key = `${markdown ? "markdown" : "gallery"}:${markdown ? resolved : root}`;
    const existing = identities.get(key);
    if (existing) return markdown ? document(get(existing)) : gallery(get(existing), path.basename(resolved));
    if (opening.has(key)) {
      const result = await opening.get(key);
      return markdown ? result : gallery(get(result.id), path.basename(resolved));
    }
    const loading = (async () => {
      const record = { kind: markdown ? "markdown" : "gallery", file: resolved, root, key, directory: await fsp.lstat(root, { bigint: true }) };
      // Register only after a successful read, so failed opens cannot retain filesystem access.
      if (markdown) {
        const source = await snapshot(resolved);
        Object.assign(record, decodeMarkdown(source.data), { source });
        remember(record); return document(record);
      }
      const result = await gallery(record, path.basename(resolved));
      remember(record); return { ...result, id: record.id };
    })();
    opening.set(key, loading);
    try { return await loading; } finally { opening.delete(key); }
  }
  async function asset(id, relative, galleryOnly = false) {
    const record = get(id, galleryOnly ? "gallery" : "markdown");
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
  async function save(id, text, copy = false) {
    let record, acquired = false;
    try {
      record = get(id, "markdown");
      if (record.busy) return { error: "This document is still saving." };
      if (typeof text !== "string" || typeof copy !== "boolean") throw new Error("Invalid Markdown save request.");
      if (text.includes("\0")) throw new Error("Markdown must be a UTF-8 text file.");
      if (Buffer.byteLength(text, "utf8") > MAX_MARKDOWN_BYTES) throw new Error("Markdown is limited to 5 MB.");
      record.busy = true;
      acquired = true;
      await checkRoot(record);
      let file = record.file;
      if (copy) {
        file = await chooseSavePath?.(path.basename(record.file));
        if (!file) return { cancelled: true };
        if (!path.isAbsolute(file) || !MARKDOWN_FILE.test(file)) throw new Error("Save the copy with a .md or .markdown extension.");
        checkDiskPath(file);
        file = path.join(await fsp.realpath(path.dirname(file)), path.basename(file));
        if (file === record.file) throw new Error("Choose a different file name to save a copy.");
        const other = identities.get(`markdown:${file}`);
        if (other && other !== record.id) throw new Error("That file is already open. Choose another name.");
      }
      let expected;
      try { expected = await snapshot(file); }
      catch (error) { if (!copy && error.code === "ENOENT") throw conflict(); if (!copy || error.code !== "ENOENT") throw error; }
      if (!copy && (!sameFile(expected.stat, record.source.stat) || expected.digest !== record.source.digest || expected.stat.ctimeNs !== record.source.stat.ctimeNs)) throw conflict();
      if (expected && !(expected.stat.mode & 0o222n)) throw new Error("This file is read-only. Save a copy in another folder.");
      const normalized = text.replace(/\r\n|\r/g, "\n");
      const data = Buffer.from((record.bom ? "\ufeff" : "") + normalized.replace(/\n/g, record.eol), "utf8");
      if (data.length > MAX_MARKDOWN_BYTES) throw new Error("Markdown is limited to 5 MB.");
      const root = path.dirname(file), directory = await fsp.lstat(root, { bigint: true });
      if (!directory.isDirectory() || !(directory.mode & 0o222n)) throw new Error("This folder is read-only. Save a copy elsewhere.");
      const temp = path.join(root, `.folio-${crypto.randomUUID()}.tmp`);
      let handle;
      try {
        handle = await fsp.open(temp, "wx", expected ? Number(expected.stat.mode & 0o777n) : 0o600);
        if (expected) await handle.chmod(Number(expected.stat.mode & 0o777n));
        await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
        if (!sameFile(directory, await fsp.lstat(root, { bigint: true }))) throw conflict();
        if (expected) {
          const current = await snapshot(file);
          if (!sameFile(expected.stat, current.stat) || expected.digest !== current.digest || expected.stat.ctimeNs !== current.stat.ctimeNs) throw conflict();
        } else {
          try { await fsp.lstat(file); throw conflict(); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        if (expected) await fsp.rename(temp, file);
        else await fsp.link(temp, file);
      } finally { await handle?.close(); await fsp.rm(temp, { force: true }); }
      const source = await snapshot(file);
      identities.delete(record.key);
      Object.assign(record, { file, root, directory, key: `markdown:${file}`, source, text: normalized });
      identities.set(record.key, record.id);
      return { ok: true, document: document(record) };
    } catch (error) {
      return error.conflict ? { conflict: true } : { error: error.code === "EACCES" || error.code === "EPERM" || error.code === "EROFS" ? "Couldn't write this file. Save a copy in another folder." : error.message };
    } finally { if (acquired) record.busy = false; }
  }
  return { open, save, asset, image: (id, name) => asset(id, name, true),
    reload: async id => loadMarkdown(get(id, "markdown")), refresh: async (id, selected) => gallery(get(id, "gallery"), selected),
    release(id) { const record = get(id); if (record.busy) throw new Error("This document is still saving."); records.delete(id); identities.delete(record.key); },
    clear() { records.clear(); identities.clear(); } };
}

module.exports = { createContentFiles, imageInfo, MARKDOWN_FILE, IMAGE_FILE, MAX_MARKDOWN_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS };
