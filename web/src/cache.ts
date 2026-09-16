import { FEATURE_VERSION, ENGINE_CONFIG, type Analysis, type ParsedGame } from '../../packages/chess-core/src/types.ts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('eloguess', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('analyses', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function analysisKey(game: ParsedGame) {
  const input = new TextEncoder().encode(JSON.stringify({ game, engine: ENGINE_CONFIG, featureVersion: FEATURE_VERSION }));
  const hash = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function cachedAnalysis(key: string): Promise<Analysis | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('analyses', 'readonly');
      const request = transaction.objectStore('analyses').get(key);
      request.onsuccess = () => resolve(request.result?.analysis || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    });
  } catch { return null; } // Storage can be unavailable in private browsing.
}
export async function saveAnalysis(key: string, analysis: Analysis) {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('analyses', 'readwrite');
      const store = transaction.objectStore('analyses');
      store.put({ key, analysis, updated: Date.now() });
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result.sort((a,b) => b.updated-a.updated);
        records.slice(20).forEach(record => store.delete(record.key));
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    });
  } catch { /* Analysis is usable even if local storage is full or disabled. */ }
}
