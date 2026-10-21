// 이 브라우저 안의 큰 저장 공간(IndexedDB)
//  - 연습 모드: 서버 대신 자료 그림(이미지 · PDF 쪽 · 연습 그림)을 여기에 둔다. 같은 컴퓨터의 여러 창이 함께 본다.
//  - 수업 모드: 서버에서 한 번 받은 그림을 여기에 넣어 두어, 새로고침해도 다시 받지 않는다.
//  - 선생님: 만들던 자료(초안)와 직접 추가한 연습 그림을 여기에 기억한다.
// IndexedDB를 쓸 수 없는 브라우저에서는 메모리에만 둔다.

const DB_NAME = 'question-lens';
const STORE = 'kv';
const memory = new Map();
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch (e) {
          resolve(undefined);
        }
      })
  );
}

export async function idbGet(key, { remember = true } = {}) {
  if (memory.has(key)) return memory.get(key);
  const v = await run('readonly', (s) => s.get(key));
  if (v !== undefined && remember) memory.set(key, v);
  return v;
}

export async function idbSet(key, value) {
  memory.set(key, value);
  await run('readwrite', (s) => s.put(value, key));
}

export async function idbDel(key) {
  memory.delete(key);
  await run('readwrite', (s) => s.delete(key));
}

export async function idbKeys(prefix = '') {
  const keys = (await run('readonly', (s) => s.getAllKeys())) || [...memory.keys()];
  return keys.filter((k) => String(k).startsWith(prefix));
}

export async function idbDelPrefix(prefix) {
  const keys = await idbKeys(prefix);
  for (const k of keys) await idbDel(k);
}
