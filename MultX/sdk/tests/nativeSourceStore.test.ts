import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openNativeSourceSignedStore } from '../src/nativeSourceStore.js';
const key='0x'+'1'.repeat(64);
it('commits and reloads the original payload through a new database connection',async()=>{
 const factory=new IDBFactory();
 const first=await openNativeSourceSignedStore('reload',factory);
 expect(await first.get(key)).toBeNull();
 expect(await first.putIfAbsent(key,'0xaabb')).toBe('0xaabb');first.close();
 const second=await openNativeSourceSignedStore('reload',factory);
 expect(await second.get(key)).toBe('0xaabb');
 expect(await second.putIfAbsent(key,'0xccdd')).toBe('0xaabb');second.close();
});
it('concurrent connections agree on one payload without overwriting',async()=>{
 const factory=new IDBFactory();
 const a=await openNativeSourceSignedStore('race',factory),b=await openNativeSourceSignedStore('race',factory);
 const results=await Promise.all([a.putIfAbsent(key,'0xaa'),b.putIfAbsent(key,'0xbb')]);
 expect(results[0]).toBe(results[1]);expect(await b.get(key)).toBe(results[0]);a.close();b.close();
});
it('refuses invalid keys and payloads and closed storage',async()=>{
 const store=await openNativeSourceSignedStore('invalid',new IDBFactory());
 await expect(store.putIfAbsent('../x','0xaa')).rejects.toThrow('key');
 await expect(store.putIfAbsent(key,'not hex')).rejects.toThrow('payload');
 expect(await store.get(key)).toBeNull();store.close();
 await expect(store.putIfAbsent(key,'0xaa')).rejects.toThrow();
});
it('rejects unavailable IndexedDB rather than using memory',async()=>{
 await expect(openNativeSourceSignedStore('missing',null as unknown as IDBFactory)).rejects.toThrow('unavailable');
});
it('aborts on corrupt saved data',async()=>{
 const factory=new IDBFactory();
 const store=await openNativeSourceSignedStore('corrupt',factory);
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=factory.open('corrupt',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('signedSteps','readwrite');tx.objectStore('signedSteps').add({key,raw:42});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
 await expect(store.get(key)).rejects.toThrow('invalid stored');db.close();store.close();
});
