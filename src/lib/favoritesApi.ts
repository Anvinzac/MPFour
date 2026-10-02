import type { FavoriteRecord, MediaFile } from '../types'

const API_BASE = '/api'
const LOCAL_KEY = 'mpfour:favorites'

// The portable single-file build (file://, e.g. on Windows 7) has no Node
// server, so favorites live in localStorage instead of SQLite.
let serverAvailable: boolean | null =
  typeof location !== 'undefined' && location.protocol === 'file:' ? false : null

function readLocal(): FavoriteRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as FavoriteRecord[]) : []
  } catch {
    return []
  }
}

function writeLocal(records: FavoriteRecord[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records))
}

async function withServer<T>(
  remote: () => Promise<T>,
  local: () => T,
): Promise<T> {
  if (serverAvailable === false) return local()
  try {
    const result = await remote()
    serverAvailable = true
    return result
  } catch (err) {
    if (serverAvailable === true) throw err
    serverAvailable = false
    return local()
  }
}

export async function fetchFavorites(): Promise<FavoriteRecord[]> {
  return withServer(
    async () => {
      const res = await fetch(`${API_BASE}/favorites`)
      if (!res.ok) throw new Error('Failed to load favorites')
      return res.json() as Promise<FavoriteRecord[]>
    },
    readLocal,
  )
}

export function mediaToFavoritePayload(
  file: MediaFile,
  rootFolderName: string,
): Omit<FavoriteRecord, 'created_at'> {
  return {
    media_id: file.id,
    folder_id: file.folderId,
    relative_path: file.relativePath,
    name: file.name,
    kind: file.kind,
    root_folder_name: rootFolderName,
  }
}

export async function saveFavorite(
  file: MediaFile,
  rootFolderName: string,
): Promise<FavoriteRecord> {
  const payload = mediaToFavoritePayload(file, rootFolderName)
  return withServer(
    async () => {
      const res = await fetch(`${API_BASE}/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Failed to save favorite')
      return res.json() as Promise<FavoriteRecord>
    },
    () => {
      const record: FavoriteRecord = { ...payload, created_at: Date.now() }
      writeLocal([
        record,
        ...readLocal().filter((fav) => fav.media_id !== record.media_id),
      ])
      return record
    },
  )
}

export async function removeFavorite(mediaId: string): Promise<void> {
  return withServer(
    async () => {
      const res = await fetch(
        `${API_BASE}/favorites/${encodeURIComponent(mediaId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 404) {
        throw new Error('Failed to remove favorite')
      }
    },
    () => {
      writeLocal(readLocal().filter((fav) => fav.media_id !== mediaId))
    },
  )
}
