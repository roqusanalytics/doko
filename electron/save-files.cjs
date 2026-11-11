const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { checkDiskPath, readRegular, sameFile, MAX_DOCUMENT_BYTES } = require('./document-files.cjs');
const { createSaveTemp, copySaveTemp } = require('./save-metadata.cjs');
const FORMATS = new Set(['pdf', 'png', 'jpg', 'webp', 'html', 'txt', 'csv', 'md', 'json', 'zip']);
const conflict = () => Object.assign(new Error('The file changed on disk. Save a copy instead.'), { conflict: true });
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
async function snapshot(file) {
  const before = await fsp.lstat(file, { bigint: true });
  if (!before.isFile()) throw new Error('Choose a regular file, not a symbolic link.');
  const data = await readRegular(file);
  const stat = await fsp.lstat(file, { bigint: true });
  if (!sameFile(before, stat) || before.ctimeNs !== stat.ctimeNs) throw conflict();
  return { stat, digest: digest(data) };
}
// Sync providers can update metadata without editing content; keep identity and byte checks.
const unchanged = (a, b) => sameFile(a.stat, b.stat) && a.digest === b.digest;
function createSaveFiles({ chooseSavePath }) {
  const records = new Map();
  let busy = false;
  return {
    clear: () => records.clear(),
    async save(request) {
      if (busy) return { error: 'Another file is still saving.' };
      busy = true;
      let temp, handle, pending;
      try {
        if (!request || typeof request !== 'object' || !FORMATS.has(request.format)
          || typeof request.name !== 'string' || !request.name || request.name.length > 240
          || /[/\\\x00-\x1f]/.test(request.name) || !request.name.toLowerCase().endsWith('.' + request.format)
          || !(request.data instanceof Uint8Array) || (!request.data.byteLength && !['txt', 'csv', 'md'].includes(request.format)) || request.data.byteLength > MAX_DOCUMENT_BYTES
          || request.saveAs !== undefined && typeof request.saveAs !== 'boolean'
          || request.id !== undefined && typeof request.id !== 'string') throw new Error('Invalid file save request.');
        const submittedDigest = digest(request.data);
        const previous = request.id === undefined ? null : records.get(request.id);
        if (request.id !== undefined && !previous) throw new Error('This save location is no longer available.');
        if (previous && previous.format !== request.format) throw new Error('Choose Save As for another file format.');
        let file = previous?.file;
        const choosing = !previous || request.saveAs;
        if (choosing) {
          file = await chooseSavePath(request.name, request.format);
          if (!file) return { cancelled: true };
          if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.' + request.format) throw new Error('Use the selected file format extension.');
          checkDiskPath(file);
          file = path.join(await fsp.realpath(path.dirname(file)), path.basename(file));
        }
        const root = path.dirname(file), directory = await fsp.lstat(root, { bigint: true });
        if (!directory.isDirectory() || !(directory.mode & 0o222n)) throw new Error('This folder is read-only. Choose another folder.');
        if (!choosing && !sameFile(directory, previous.directory)) throw conflict();
        let expected;
        try { expected = await snapshot(file); }
        catch (error) { if (error.code !== 'ENOENT') throw error; if (!choosing) throw conflict(); }
        if (!choosing && !unchanged(expected, previous.source)) throw conflict();
        if (expected && !(expected.stat.mode & 0o222n)) throw new Error('This file is read-only. Save a copy elsewhere.');
        pending = await createSaveTemp(root, expected && { file, stat: expected.stat });
        ({ temp, handle } = pending);
        await handle.writeFile(request.data); await pending.verify(); await handle.sync(); await handle.close(); handle = null;
        if (!sameFile(directory, await fsp.lstat(root, { bigint: true }))) throw conflict();
        if (expected) {
          const current = await snapshot(file);
          if (!unchanged(expected, current) || expected.stat.ctimeNs !== current.stat.ctimeNs) throw conflict();
        }
        else { try { await fsp.lstat(file); throw conflict(); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
        if (expected) await fsp.rename(temp, file);
        else {
          try { await fsp.link(temp, file); }
          catch (error) {
            if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error;
            await copySaveTemp(temp, file);
          }
          await fsp.unlink(temp);
        }
        temp = null;
        const source = await snapshot(file);
        if (source.digest !== submittedDigest) throw conflict();
        const id = previous && !request.saveAs ? request.id : crypto.randomUUID();
        records.set(id, { file, directory, source, format: request.format });
        return { ok: true, id, name: path.basename(file) };
      } catch (error) {
        return error.conflict ? { conflict: true } : { error: ['EACCES', 'EPERM', 'EROFS'].includes(error.code) ? "Couldn't save this file. Choose another folder." : error.message };
      } finally {
        await handle?.close().catch(() => {});
        await pending?.cleanup().catch(() => {});
        busy = false;
      }
    },
  };
}
module.exports = { createSaveFiles };
