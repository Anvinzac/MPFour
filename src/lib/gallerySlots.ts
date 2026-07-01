import { shuffle } from './shuffle'
import type { GallerySlot, MediaFile } from '../types'

/** Round-robin interleave across root folders so each source contributes evenly. */
export function createDiversifiedSlots(pool: MediaFile[]): GallerySlot[] {
  if (pool.length === 0) return []

  const byFolder = new Map<string, MediaFile[]>()
  for (const file of pool) {
    const list = byFolder.get(file.folderId) ?? []
    list.push(file)
    byFolder.set(file.folderId, list)
  }

  for (const [folderId, files] of byFolder) {
    byFolder.set(folderId, shuffle(files))
  }

  const folderOrder = shuffle([...byFolder.keys()])
  const mixed: MediaFile[] = []
  let hasMore = true

  while (hasMore) {
    hasMore = false
    for (const folderId of folderOrder) {
      const queue = byFolder.get(folderId)!
      if (queue.length > 0) {
        mixed.push(queue.shift()!)
        hasMore = true
      }
    }
  }

  return mixed.map((media) => ({
    key: media.id,
    media,
    useFixedHeight: false,
  }))
}

export function createDisplaySlots(pool: MediaFile[]): GallerySlot[] {
  return createDiversifiedSlots(pool)
}

export function appendDisplaySlots(
  existing: GallerySlot[],
  newFiles: MediaFile[],
): GallerySlot[] {
  const existingIds = new Set(existing.map((slot) => slot.media.id))
  const toAdd = shuffle(newFiles.filter((file) => !existingIds.has(file.id)))
  if (toAdd.length === 0) return existing

  const newSlots = toAdd.map((media) => ({
    key: media.id,
    media,
    useFixedHeight: false,
  }))
  return [...existing, ...newSlots]
}

export function replaceFolderInGallery(
  pool: MediaFile[],
  slots: GallerySlot[],
  folderId: string,
  newFiles: MediaFile[],
): { pool: MediaFile[]; slots: GallerySlot[] } {
  const nextPool = dedupeMediaFiles([
    ...filterByFolder(pool, folderId),
    ...newFiles,
  ])

  const baseSlots = slots.filter((slot) => slot.media.folderId !== folderId)
  const nextSlots =
    baseSlots.length === 0 && slots.length === 0
      ? createDisplaySlots(newFiles)
      : appendDisplaySlots(baseSlots, newFiles)

  return { pool: nextPool, slots: nextSlots }
}

export function appendToGallery(
  pool: MediaFile[],
  slots: GallerySlot[],
  newFiles: MediaFile[],
): { pool: MediaFile[]; slots: GallerySlot[] } {
  return {
    pool: dedupeMediaFiles([...pool, ...newFiles]),
    slots: appendDisplaySlots(slots, newFiles),
  }
}

function filterByFolder(files: MediaFile[], folderId: string): MediaFile[] {
  return files.filter((file) => file.folderId !== folderId)
}

function dedupeMediaFiles(files: MediaFile[]): MediaFile[] {
  const seen = new Set<string>()
  const unique: MediaFile[] = []
  for (const file of files) {
    if (seen.has(file.id)) continue
    seen.add(file.id)
    unique.push(file)
  }
  return unique
}

export function pickSlotReplacement(
  mediaPool: MediaFile[],
  onScreenIds: Set<string>,
  tried: Set<string>,
): MediaFile | null {
  const available = mediaPool.filter((file) => !tried.has(file.id))
  if (available.length === 0) return null

  const offScreen = available.filter((file) => !onScreenIds.has(file.id))
  const pool = offScreen.length > 0 ? offScreen : available

  // Prefer images — they don't need a video-pool slot.
  const image = pool.find((file) => file.kind === 'image')
  if (image) return image

  return pool[0] ?? null
}
