import type { FavoriteRecord, MediaFile } from '../types'

const API_BASE = '/api'

export async function fetchFavorites(): Promise<FavoriteRecord[]> {
  const res = await fetch(`${API_BASE}/favorites`)
  if (!res.ok) throw new Error('Failed to load favorites')
  return res.json() as Promise<FavoriteRecord[]>
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
  const res = await fetch(`${API_BASE}/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mediaToFavoritePayload(file, rootFolderName)),
  })
  if (!res.ok) throw new Error('Failed to save favorite')
  return res.json() as Promise<FavoriteRecord>
}

export async function removeFavorite(mediaId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/favorites/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 404) {
    throw new Error('Failed to remove favorite')
  }
}
