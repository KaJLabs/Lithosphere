import type { NativeSourceSignedStore } from './nativeSource.js';

export interface NativeSourceBrowserStore extends NativeSourceSignedStore {
  close(): void;
}
const validKey = (key: string) => {
  if (!/^0x[0-9a-f]{64}$/.test(key)) throw Error('invalid source storage key');
};
const validRaw = (raw: unknown): string => {
  if (typeof raw !== 'string' || raw.length > 4096 || !/^0x[0-9a-f]+$/i.test(raw)) throw Error('invalid stored source payload');
  return raw;
};

/** Origin-scoped IndexedDB storage. A write resolves only after transaction commit. */
export async function openNativeSourceSignedStore(
  name = 'multx-native-source-v1',
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<NativeSourceBrowserStore> {
  if (!factory || !name.trim()) throw Error('persistent browser storage unavailable');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore('signedSteps', { keyPath: 'key' });
    };
    request.onerror = () => { failed = true; reject(Error('source storage open failed')); };
    request.onblocked = () => { failed = true; reject(Error('source storage upgrade blocked')); };
    request.onsuccess = () => {
      if (failed) request.result.close(); else resolve(request.result);
    };
  });
  db.onversionchange = () => db.close();
  async function access(key: string, raw?: string): Promise<string | null> {
    validKey(key);
    if (raw !== undefined) validRaw(raw);
    return new Promise((resolve, reject) => {
      // Unsupported/unavailable storage rejects; never fall back to memory.
      const tx = db.transaction('signedSteps', raw === undefined ? 'readonly' : 'readwrite', { durability: 'strict' });
      const store = tx.objectStore('signedSteps');
      let result: string | null = null;
      let invalid = false;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(Error(invalid ? 'invalid stored source payload' : 'source storage transaction aborted'));
      const get = store.get(key);
      get.onsuccess = () => {
        try {
          if (get.result !== undefined) result = validRaw(get.result.raw);
          else if (raw !== undefined) {
            result = raw;
            store.add({ key, raw });
          }
        } catch {
          invalid = true;
          tx.abort();
        }
      };
    });
  }
  return {
    get: key => access(key),
    putIfAbsent: async (key, raw) => (await access(key, raw))!,
    close: () => db.close(),
  };
}
