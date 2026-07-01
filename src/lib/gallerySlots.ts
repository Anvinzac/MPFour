import { shuffle } from './shuffle'
import type { GallerySlot, MediaFile } from '../types'

/** Max share of other-folder cells to swap per graft (keeps most previews alive). */
const MAX_CROSS_FOLDER_GRAFT_RATIO = 0.4

/** Round-robin interleave across root folders (used for Refresh / first load). */
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

/**
 * Swap some other-folder cells with new files (spread top-to-bottom).
 * Same-folder discoveries only append — never replace what's already playing.
 */
export function graftFilesIntoSlots(
  existing: GallerySlot[],
  newFiles: MediaFile[],
): GallerySlot[] {
  const shownIds = new Set(existing.map((slot) => slot.media.id))
  const toGraft = shuffle(newFiles.filter((file) => !shownIds.has(file.id)))
  if (toGraft.length === 0) return existing

  if (existing.length === 0) {
    return toGraft.map((media) => ({
      key: media.id,
      media,
      useFixedHeight: true,
    }))
  }

  const newFolderId = toGraft[0].folderId
  const result = existing.map((slot) => ({ ...slot }))

  const replaceable: number[] = []
  for (let i = 0; i < result.length; i++) {
    if (result[i].media.folderId !== newFolderId) {
      replaceable.push(i)
    }
  }

  // Same folder still scanning — append only, do not touch visible cells.
  if (replaceable.length === 0) {
    return appendDisplaySlots(existing, toGraft)
  }

  const graftCount = Math.min(
    toGraft.length,
    Math.max(1, Math.ceil(replaceable.length * MAX_CROSS_FOLDER_GRAFT_RATIO)),
  )
  const step = Math.max(1, Math.floor(replaceable.length / graftCount))

  let grafted = 0
  for (let t = 0; t < replaceable.length && grafted < graftCount; t += step) {
    const idx = replaceable[t]
    const media = toGraft[grafted++]
    result[idx] = { key: media.id, media, useFixedHeight: true }
  }

  while (grafted < toGraft.length) {
    const media = toGraft[grafted++]
    result.push({ key: media.id, media, useFixedHeight: true })
  }

  return result
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
    useFixedHeight: true,
  }))
  return [...existing, ...newSlots]
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

  const image = pool.find((file) => file.kind === 'image')
  if (image) return image

  return pool[0] ?? null
}
