// Recently opened files, kept locally in IndexedDB so they can be reopened with one click.

export interface RecentFile {
  id: string;
  name: string;
  size: number;
  pages: number;
  openedAt: number;
  lastPage: number;
  thumb: string;
  data: Blob;
}

const DB_NAME = "folio";
const STORE = "recent";
const POSITIONS = "recentPositions";
const LEGACY = "recentByName";
const NOTES = "notes";
const AI = "ai";
const MAX_RECENT = 8;
/** Bigger files aren't kept in Recent: each entry stores the whole PDF, so a few 300 MB downloads would be gigabytes of copies on disk. */
export const MAX_RECENT_FILE_BYTES = 50 * 1024 * 1024;
let connection: Promise<IDBDatabase> | null = null;

export function openFolioDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 7);
    let blocked = false;
    req.onblocked = () => {
      blocked = true;
      connection = null;
      reject(new Error("Close other Doko windows and retry to update local storage."));
    };
    req.onupgradeneeded = event => {
      const database = req.result;
      // Older cards can pair one file's preview and position with another file's bytes.
      if (event.oldVersion < 4) {
        if (database.objectStoreNames.contains(STORE)) req.transaction!.objectStore(STORE).name = LEGACY;
        database.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(POSITIONS)) database.createObjectStore(POSITIONS);
      if (!database.objectStoreNames.contains(NOTES)) database.createObjectStore(NOTES, { keyPath: "id" });
      if (!database.objectStoreNames.contains(AI)) database.createObjectStore(AI, { keyPath: "id" });
      if (event.oldVersion < 5) {
        database.createObjectStore("versions", { keyPath: "id" }).createIndex("byFamily", ["family", "number"], { unique: true });
        database.createObjectStore("versionPdfs");
      }
      if (!database.objectStoreNames.contains("clearGenerations")) database.createObjectStore("clearGenerations");
    };
    req.onsuccess = () => {
      const database = req.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => { database.close(); connection = null; };
      database.onclose = () => { connection = null; };
      // A migration that runs out of quota can retry next time. Notes and chat still work.
      migrateRecent(database).catch(() => {}).then(() => resolve(database));
    };
    req.onerror = () => { connection = null; reject(req.error); };
  });
  return connection;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await openFolioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const req = fn(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(req.result);
    transaction.onabort = () => reject(transaction.error);
    req.onerror = () => reject(req.error);
  });
}

export async function contentKey(data: Uint8Array) {
  // Up to 2 MiB the old key already hashed every byte. Larger sampled keys cannot prove
  // which file owns old notes or chat, even if a file with the same sample is still in Recent.
  const prefix = data.byteLength <= 2 * 1024 * 1024 ? "sha256:" : "sha256-full:";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
  return prefix + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("") + ":" + data.byteLength;
}

async function migrateRecent(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(LEGACY)) return;
  const old = await new Promise<RecentFile[]>((resolve, reject) => {
    const request = database.transaction(LEGACY).objectStore(LEGACY).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const file of old.sort((a, b) => b.openedAt - a.openedAt)) {
    let id: string | undefined;
    if (file.data instanceof Blob && file.data.size <= MAX_RECENT_FILE_BYTES) {
      try { id = await contentKey(new Uint8Array(await file.data.arrayBuffer())); } catch { continue; }
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([LEGACY, STORE], "readwrite");
      const legacy = transaction.objectStore(LEGACY);
      const current = transaction.objectStore(STORE);
      // Two tabs can start the same migration. Moving each row atomically avoids resurrecting a removed card.
      const source = legacy.getKey(file.id);
      source.onsuccess = () => {
        if (source.result === undefined) return;
        legacy.delete(file.id);
        if (!id) return;
        const dest = current.getKey(id);
        dest.onsuccess = () => {
          if (dest.result === undefined) current.put({ ...file, id, size: file.data.size, thumb: "", lastPage: 1 });
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

export async function listRecent(): Promise<RecentFile[]> {
  try {
    const all = await tx<RecentFile[]>("readonly", (s) => s.getAll());
    const positions = await Promise.all(all.map(file => tx<number | undefined>("readonly", s => s.get(file.id), POSITIONS)));
    return all.map((file, index) => ({ ...file, lastPage: positions[index] ?? file.lastPage })).sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

export async function getRecent(id: string): Promise<RecentFile | undefined> {
  try {
    const file = await tx<RecentFile | undefined>("readonly", (s) => s.get(id));
    if (!file) return undefined;
    return { ...file, lastPage: await tx<number | undefined>("readonly", s => s.get(id), POSITIONS) ?? file.lastPage };
  } catch {
    return undefined;
  }
}

export async function saveRecent(file: RecentFile) {
  try {
    const database = await openFolioDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([STORE, POSITIONS], "readwrite");
      const store = transaction.objectStore(STORE);
      const positions = transaction.objectStore(POSITIONS);
      store.put(file);
      positions.put(file.lastPage, file.id);
      const all: IDBRequest<RecentFile[]> = store.getAll();
      all.onsuccess = () => {
        for (const old of all.result.sort((a, b) => b.openedAt - a.openedAt).slice(MAX_RECENT)) {
          store.delete(old.id);
          positions.delete(old.id);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    /* storage may be unavailable (private mode); recent files are best-effort */
  }
}

export async function updateLastPage(id: string, lastPage: number) {
  if (!Number.isInteger(lastPage) || lastPage < 1) return;
  try {
    const database = await openFolioDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([STORE, POSITIONS], "readwrite");
      const request = transaction.objectStore(STORE).getKey(id);
      request.onsuccess = () => {
        if (request.result !== undefined) transaction.objectStore(POSITIONS).put(lastPage, id);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {}
}

export async function clearRecent() {
  try {
    const db = await openFolioDatabase();
    const stores = db.objectStoreNames.contains(LEGACY) ? [STORE, POSITIONS, LEGACY] : [STORE, POSITIONS];
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(stores, "readwrite");
      for (const name of stores) transaction.objectStore(name).clear();
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    /* ignore */
  }
}

export async function removeRecent(id: string) {
  try {
    const db = await openFolioDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE, POSITIONS], "readwrite");
      transaction.objectStore(STORE).delete(id);
      transaction.objectStore(POSITIONS).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    /* ignore */
  }
}

// ── Highlights and notes ──────────────────────────────────────────────
// Saved per document (same id as Recent) so markup survives closing Doko.

export interface StoredMark {
  id: string;
  type: "highlight" | "ink" | "freetext";
  shape?: import("./shapes").Shape;
  page: number; // 0-based
  text: string;
  note: string;
  color: string;
  createdAt: number;
  /** pdf.js editor serialization, used to recreate the mark. */
  data: Record<string, unknown>;
}

export interface DocNotes {
  id: string;
  note: string;
  marks: StoredMark[];
  bookmarkedPages?: number[]; // One-based, absent in older records.
  updatedAt: number;
}

export type StoredCategory = typeof NOTES | typeof AI;
const CLEAR_CHANNEL = "folio:stored-data-cleared";

export function onStoredDataCleared(listener: (category: StoredCategory, generation: number) => void) {
  const channel = new BroadcastChannel(CLEAR_CHANNEL);
  channel.onmessage = ({ data }) => listener(data.category, data.generation);
  return () => channel.close();
}

export async function countStoredData() {
  const [notes, ai] = await Promise.all([NOTES, AI].map(store => tx("readonly", s => s.count(), store)));
  return { notes, ai };
}

// Read the generation in the same transaction as the record. A suspended tab or an old autosave
// can then never write a cleared annotation or conversation back, even before its notification arrives.
async function withGeneration<T>(category: StoredCategory, mode: IDBTransactionMode,
  run: (store: IDBObjectStore, generation: number, generations: IDBObjectStore) => IDBRequest<T> | void) {
  const db = await openFolioDatabase();
  return new Promise<{ value: T | undefined; generation: number }>((resolve, reject) => {
    const transaction = db.transaction([category, "clearGenerations"], mode);
    const generations = transaction.objectStore("clearGenerations");
    const read = generations.get(category);
    let result: IDBRequest<T> | void;
    let failure: unknown;
    read.onsuccess = () => {
      try { result = run(transaction.objectStore(category), read.result ?? 0, generations); }
      catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve({ value: result?.result, generation: read.result ?? 0 });
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Stored data is unavailable."));
  });
}

export async function clearStoredData(category: StoredCategory) {
  const { generation } = await withGeneration(category, "readwrite", (store, current, generations) => {
    generations.put(current + 1, category);
    return store.clear();
  });
  const channel = new BroadcastChannel(CLEAR_CHANNEL);
  channel.postMessage({ category, generation: generation + 1 });
  channel.close();
}

async function readStored<T>(category: StoredCategory, id: string) {
  return withGeneration<T | undefined>(category, "readonly", store => store.get(id));
}

async function saveStored(category: StoredCategory, id: string, value: unknown, generation: number) {
  await withGeneration(category, "readwrite", (store, current) => {
    if (generation !== current) return;
    if (value) store.put(value);
    else store.delete(id);
  });
}

export function getNotes(id: string) {
  return readStored<DocNotes>(NOTES, id);
}

export function saveNotes(notes: DocNotes, generation: number) {
  const keep = notes.note.trim() || notes.marks.length || notes.bookmarkedPages?.length;
  return saveStored(NOTES, notes.id, keep ? notes : undefined, generation);
}

// ── Ask AI conversations ──────────────────────────────────────────────
// One conversation per document (same content-based id as notes), so it's there when the document is reopened.

export interface StoredAiMessage {
  role: "user" | "assistant";
  content: string;
  context?: { text: string; page: number };
}

export async function getAiHistory(id: string) {
  const { value, generation } = await readStored<{ messages: StoredAiMessage[] }>(AI, id);
  return { messages: Array.isArray(value?.messages) ? value.messages : [], generation };
}

export function saveAiHistory(id: string, messages: StoredAiMessage[], generation: number) {
  return saveStored(AI, id, messages.length ? { id, messages, updatedAt: Date.now() } : undefined, generation);
}

// The PDF already embeds annotations; only device-only reading details and chat follow its new hash.
export async function copySavedPdfData(id: string, notes: Pick<DocNotes, "note" | "bookmarkedPages">, notesGeneration: number,
  ai: Awaited<ReturnType<typeof getAiHistory>>) {
  const database = await openFolioDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([NOTES, AI, "clearGenerations"], "readwrite");
    let failure: unknown;
    const copy = (category: StoredCategory, generation: number, value: unknown) => {
      if (!value) return;
      const store = transaction.objectStore(category);
      const read = transaction.objectStore("clearGenerations").get(category);
      read.onsuccess = () => {
        if ((read.result ?? 0) !== generation) return;
        const existing = store.getKey(id);
        existing.onsuccess = () => {
          try { if (existing.result === undefined) store.put(value); }
          catch (error) { failure = error; transaction.abort(); }
        };
      };
    };
    copy(NOTES, notesGeneration, notes.note.trim() || notes.bookmarkedPages?.length ? { ...notes, id, marks: [], updatedAt: Date.now() } : undefined);
    copy(AI, ai.generation, ai.messages.length ? { id, messages: ai.messages, updatedAt: Date.now() } : undefined);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Couldn’t keep the saved copy’s reading data."));
  });
}
