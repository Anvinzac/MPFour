import type { StoredFolder } from '../types'

const DB_NAME = 'mpfour'
const DB_VERSION = 1
const STORE = 'folders'
const ACTIVE_KEY = 'mpfour:activeFolderIds'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const store = tx.objectStore(STORE)
        const request = fn(store)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export async function saveFolder(folder: StoredFolder): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(folder))
}

export async function listFolders(): Promise<StoredFolder[]> {
  const folders = await runTransaction<StoredFolder[]>('readonly', (store) =>
    store.getAll(),
  )
  return folders.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export async function getFolder(id: string): Promise<StoredFolder | undefined> {
  return runTransaction<StoredFolder | undefined>('readonly', (store) =>
    store.get(id),
  )
}

export async function deleteFolderFromHistory(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id))
}

export async function touchFolder(id: string): Promise<void> {
  const folder = await getFolder(id)
  if (!folder) return
  folder.lastUsedAt = Date.now()
  await saveFolder(folder)
}

export function getActiveFolderIds(): string[] {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

export function setActiveFolderIds(ids: string[]): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(ids))
}

/**
 * Never throws — safe to call during automatic restore (page load, no user
 * gesture). `requestPermission` under those conditions throws a
 * `SecurityError` rather than returning 'denied', which — if uncaught —
 * rejects the whole `Promise.all` restore batch and leaves the app stuck on
 * "Restoring folders…" forever (a blank grid with no error surfaced).
 */
export async function queryReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    return (await handle.queryPermission({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

/** Requires a user gesture (click). Use only from direct click handlers. */
export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const options = { mode: 'read' as const }
  try {
    if ((await handle.queryPermission(options)) === 'granted') return true
    return (await handle.requestPermission(options)) === 'granted'
  } catch {
    return false
  }
}
