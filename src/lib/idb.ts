/* Recorded audio that has not been sent yet is also written here, so it survives a closed tab.
   Database "sidenote", version 1, store "chunks" keyed by "key" (lectureId:seq). */
export interface StoredChunk { key: string; id: string; seq: number; blob: Blob; sec: number; code: string }

export const idb = { db: null as IDBDatabase | null,
  open() { return new Promise<boolean>(res => { try { const r = indexedDB.open("sidenote", 1); r.onupgradeneeded = () => r.result.createObjectStore("chunks", { keyPath: "key" }); r.onsuccess = () => { idb.db = r.result; res(true); }; r.onerror = () => res(false); r.onblocked = () => res(false); } catch (e) { res(false); } }); },
  tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | null) { return new Promise<T | null>(res => { if (!idb.db) return res(null); try { const t = idb.db.transaction("chunks", mode), rq = fn(t.objectStore("chunks")); t.oncomplete = () => res(rq ? rq.result : null); t.onerror = () => res(null); t.onabort = () => res(null); } catch (e) { res(null); } }); },
  put(c: StoredChunk) { return idb.tx("readwrite", s => s.put(c)); }, del(key: string) { return idb.tx("readwrite", s => s.delete(key)); }, all() { return idb.tx<StoredChunk[]>("readonly", s => s.getAll()); }
};
