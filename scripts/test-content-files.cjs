const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
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

    const saved = await files.save(first.id, "# Edited\nText\n");
    assert.equal(saved.ok, true, JSON.stringify(saved));
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

    const pictures = path.join(root, "pictures"); await fs.mkdir(pictures);
    await fs.writeFile(path.join(pictures, "photo10.png"), png());
    await fs.writeFile(path.join(pictures, "photo2.png"), png());
    await fs.writeFile(path.join(pictures, "photo1.png"), png());
    await fs.writeFile(path.join(pictures, "ignored.txt"), "text");
    await fs.mkdir(path.join(pictures, "nested"));
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
    await assert.rejects(files.open(path.join(root, "ignored.txt")), /Markdown/);
    files.clear();
    await assert.rejects(files.reload(second.id), /no longer open/);
    console.log("Content files: Markdown saves/conflicts/encoding, image formats/limits, gallery identity, path and symlink isolation passed.");
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
