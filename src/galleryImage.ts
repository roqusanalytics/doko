// Selection copies keep files identity; refresh/replacement supplies a new list.
const pending = new WeakMap<string[], Map<string, Promise<Blob | undefined>>>();

export function readGalleryImage(doc: Pick<GalleryDocument, "id" | "files" | "blobs">, name: string): Promise<Blob | undefined> {
  const local = doc.blobs?.[name];
  if (local) return Promise.resolve(local);
  if (!doc.id || !window.folioDesktop) return Promise.resolve(undefined);
  let reads = pending.get(doc.files);
  if (!reads) { reads = new Map(); pending.set(doc.files, reads); }
  const key = `${doc.id}\0${name}`;
  const existing = reads.get(key);
  if (existing) return existing;
  const read = window.folioDesktop.content.image(doc.id, name)
    .then(result => new Blob([new Uint8Array(result.data)], { type: result.mime }))
    .finally(() => { reads.delete(key); });
  reads.set(key, read);
  return read;
}
