import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createServer } from 'vite';

const cacheDir = mkdtempSync(path.join(tmpdir(), 'doko-gallery-test-cache-'));
const server = await createServer({ cacheDir, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });

try {
  const { readGalleryImage } = await server.ssrLoadModule('/src/galleryImage.ts');
  const calls = [];
  globalThis.window = { folioDesktop: { content: { image(id, name) {
    return new Promise((resolve, reject) => calls.push({ id, name, resolve, reject }));
  } } } };
  const result = { data: new Uint8Array([1, 2, 3]), mime: 'image/png' };
  const doc = { kind: 'gallery', id: 'folder', files: ['one.png', 'two.png'], selected: 'one.png' };

  for (let trial = 0; trial < 5; trial++) {
    if (process.env.DOKO_GALLERY_BASELINE) {
      const dir = process.env.DOKO_GALLERY_BASELINE;
      const thumbnail = readFileSync(`${dir}/PhotoCarousel.tsx`, 'utf8').match(/const blob = ([\s\S]*?);\n      if \(!blob\)/)[1];
      const selected = readFileSync(`${dir}/App.tsx`, 'utf8').match(/(let blob = next.blobs\?\.\[name\];[\s\S]*?)\n        if \(!blob\)/)[1];
      const context = vm.createContext({ window, Blob, Uint8Array, doc, next: doc, name: 'one.png' });

      const before = [vm.runInContext(`(async () => (${thumbnail}))()`, context),
        vm.runInContext(`(async () => { ${selected}; return blob; })()`, context)];

      assert.equal(calls.length, 2, 'actual previous caller expressions issue duplicate concurrent IPC');
      calls.splice(0).forEach(call => call.resolve(result));
      await Promise.all(before);

      if (trial === 0) console.log('B4 before: same document/name, concurrent thumbnail + selection = 2 IPC calls');
    }

    const thumb = readGalleryImage(doc, 'one.png');
    const selection = readGalleryImage({ ...doc, selected: 'two.png' }, 'one.png');
    assert.equal(calls.length, 1); assert.equal(thumb, selection);
    calls.shift().resolve(result);
    const blob = await thumb;
    assert.equal(blob, await selection); assert.equal(blob.type, result.mime); assert.equal(blob.size, 3);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), result.data);

    if (trial === 0) console.log('B4 after: same document/name, concurrent thumbnail + selection = 1 IPC call');
  }

  console.log('B4 counters: 5 trials per side when baseline supplied; IPC count spread = 0');
  const again = readGalleryImage(doc, 'one.png'); assert.equal(calls.length, 1, 'success retains no full image');
  calls.shift().reject(new Error('File disappeared')); await assert.rejects(again, /File disappeared/);
  const retry = readGalleryImage(doc, 'one.png'); assert.equal(calls.length, 1, 'failure is evicted for retry');
  const refreshed = readGalleryImage({ ...doc, files: [...doc.files] }, 'one.png');
  const other = readGalleryImage({ ...doc, id: 'other-folder' }, 'one.png');
  const otherName = readGalleryImage(doc, 'two.png');
  assert.equal(calls.length, 4, 'refresh, native document identity and filename never share old request');
  calls.splice(0).forEach(call => call.resolve(result)); await Promise.all([retry, refreshed, other, otherName]);
  const local = new Blob(['browser'], { type: 'image/jpeg' });
  assert.equal(await readGalleryImage({ ...doc, blobs: { 'one.png': local } }, 'one.png'), local, 'browser Blob has priority');
  assert.equal(calls.length, 0);
  delete window.folioDesktop;
  assert.equal(await readGalleryImage(doc, 'one.png'), undefined);
  assert.equal(await readGalleryImage({ ...doc, blobs: { 'one.png': local } }, 'one.png'), local);
  assert.equal(await readGalleryImage({ ...doc, id: undefined }, 'one.png'), undefined);
  window.folioDesktop = { content: { image(id, name) {
    return new Promise((resolve, reject) => calls.push({ id, name, resolve, reject }));
  } } };
  const thumbnail = readFileSync('src/PhotoCarousel.tsx', 'utf8');
  const effectBody = stripTypeScriptTypes(thumbnail.slice(thumbnail.indexOf('  const [url,'), thumbnail.indexOf('  return url && !error')));
  let deps, dispose, revoked = 0;
  const renderThumbnail = new Function('doc', 'name', 'near', 'useState', 'useEffect', 'readGalleryImage', 'URL', 'MAX_BYTES', effectBody);

  const drawThumbnail = document => renderThumbnail(document, 'one.png', true, value => [value, () => {}], (effect, next) => {
    if (!deps || next.some((value, index) => value !== deps[index])) { dispose?.(); deps = next; dispose = effect(); }
  }, readGalleryImage, { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => revoked++ }, 100 * 1024 * 1024);

  drawThumbnail(doc); assert.equal(calls.length, 1); calls.shift().resolve(result);
  await new Promise(resolve => setImmediate(resolve));
  drawThumbnail({ ...doc, selected: 'two.png' });
  assert.equal(calls.length, 0, 'changing selection must retain completed unchanged thumbnails');
  assert.equal(revoked, 0, 'selection must not revoke unchanged thumbnail URL');
  drawThumbnail({ ...doc, files: [...doc.files] });
  assert.equal(calls.length, 1, 'refresh must read current bytes');
  calls.shift().resolve(result); await new Promise(resolve => setImmediate(resolve)); dispose();
  assert.equal(revoked, 2, 'refresh and unmount release their own URLs');

  // Keep both consumers on the same helper, and keep their existing validation boundaries.
  for (const file of ['src/PhotoCarousel.tsx', 'src/App.tsx']) {
    const source = readFileSync(file, 'utf8'); assert.match(source, /await readGalleryImage\(/);
    assert.doesNotMatch(source, /content\.image\(/);
  }

  assert.match(readFileSync('src/PhotoCarousel.tsx', 'utf8'), /blob.size > MAX_BYTES/);
  console.log('PASS in-flight-only lifetime, rejection/retry, refresh, document/name separation, browser Blob and native MIME/bytes');
} finally { delete globalThis.window; await server.close(); rmSync(cacheDir, { recursive: true, force: true }); }
