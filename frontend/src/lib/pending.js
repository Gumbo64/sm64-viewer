// Rewinding reloads the page (a fresh emulator instance is the only way to go
// back, and reloading guarantees the old instance's memory is released).
// The replay and the target frame survive the reload in IndexedDB.

const DB = 'sm64-viewer';
const STORE = 'pending';
const KEY = 'rewind';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/** `{ name, buffer, frame, speed, playing, source, exportJob? }` (exportJob: settings to reopen the export dialog with) */
export function savePending(p) {
  return tx('readwrite', (s) => s.put(p, KEY));
}

/** Returns and clears the pending rewind, if any. */
export async function takePending() {
  try {
    const p = await tx('readonly', (s) => s.get(KEY));
    if (p) await tx('readwrite', (s) => s.delete(KEY));
    return p ?? null;
  } catch {
    return null;
  }
}
