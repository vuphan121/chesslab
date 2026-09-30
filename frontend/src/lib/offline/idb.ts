const DB_NAME = 'chesslab-offline'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>('readonly', (s) => s.get(key))
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(value, key))
    return true
  } catch {
    return false
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key))
  } catch {
  }
}

function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, prefix + '￿')
}

export async function idbList<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const out: { key: string; value: T }[] = []
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(prefixRange(prefix))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(out)
          return
        }
        out.push({ key: String(cursor.key), value: cursor.value as T })
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function idbClear(): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.clear())
    return true
  } catch {
    return false
  }
}
