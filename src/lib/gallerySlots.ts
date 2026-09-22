import { SCAFFOLD_BATCH_SIZE } from './constants'
import { shuffle } from './shuffle'
import type { GallerySlot, MediaFile, MediaKind } from '../types'

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

function slotFromMedia(media: MediaFile): GallerySlot {
  return { key: media.id, media, useFixedHeight: false }
}

/**
 * Evenly interleave new files throughout an existing slot array so the new
 * folder is fairly distributed across the whole viewport — not appended as a
 * block at the bottom. Existing slots keep their keys, so masonic repositions
 * them without remounting (only the new cells mount fresh).
 */
function interleaveSlots(
  existing: GallerySlot[],
  newFiles: MediaFile[],
): GallerySlot[] {
  const total = existing.length + newFiles.length
  const newCount = newFiles.length

  // Evenly spaced target positions for the new files in the merged array.
  const newPositions = new Set<number>()
  for (let i = 0; i < newCount; i++) {
    newPositions.add(Math.floor((i * total) / newCount))
  }

  const merged: GallerySlot[] = []
  let ei = 0
  let ni = 0
  for (let pos = 0; pos < total; pos++) {
    if (newPositions.has(pos)) {
      merged.push(slotFromMedia(newFiles[ni++]))
    } else {
      merged.push(existing[ei++])
    }
  }
  // Defensive leftovers (correct math makes these no-ops).
  while (ei < existing.length) merged.push(existing[ei++])
  while (ni < newFiles.length) merged.push(slotFromMedia(newFiles[ni++]))
  return merged
}

/**
 * Merge newly discovered files into the visible grid. New files are evenly
 * interleaved throughout the existing slots so a freshly added folder appears
 * spread across the viewport instead of clustered at the bottom.
 */
export function graftFilesIntoSlots(
  existing: GallerySlot[],
  newFiles: MediaFile[],
): GallerySlot[] {
  const shownIds = new Set(existing.map((slot) => slot.media.id))
  const toGraft = shuffle(newFiles.filter((file) => !shownIds.has(file.id)))
  if (toGraft.length === 0) return existing

  if (existing.length === 0) {
    return toGraft.map(slotFromMedia)
  }

  return interleaveSlots(existing, toGraft)
}

export function appendDisplaySlots(
  existing: GallerySlot[],
  newFiles: MediaFile[],
): GallerySlot[] {
  const existingIds = new Set(existing.map((slot) => slot.media.id))
  const toAdd = shuffle(newFiles.filter((file) => !existingIds.has(file.id)))
  if (toAdd.length === 0) return existing

  const newSlots = toAdd.map(slotFromMedia)
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

/**
 * Pick up to `batchSize` random files with an equal quota per folder.
 * Folders with fewer undisplayed files contribute what they have; remaining
 * slots are filled randomly from any folder still holding leftovers.
 */
export function pickRandomEqualMix(
  byFolder: Map<string, MediaFile[]>,
  displayedIds: Set<string>,
  batchSize: number = SCAFFOLD_BATCH_SIZE,
): MediaFile[] {
  const folderIds = shuffle([...byFolder.keys()])
  if (folderIds.length === 0) return []

  const perFolder = Math.max(1, Math.floor(batchSize / folderIds.length))
  const picked: MediaFile[] = []
  const pickedIds = new Set<string>()

  const undisplayed = (folderId: string) =>
    shuffle(
      (byFolder.get(folderId) ?? []).filter(
        (file) => !displayedIds.has(file.id) && !pickedIds.has(file.id),
      ),
    )

  for (const folderId of folderIds) {
    for (const file of undisplayed(folderId).slice(0, perFolder)) {
      picked.push(file)
      pickedIds.add(file.id)
      if (picked.length >= batchSize) return picked
    }
  }

  if (picked.length < batchSize) {
    const leftovers: MediaFile[] = []
    for (const folderId of folderIds) {
      for (const file of byFolder.get(folderId) ?? []) {
        if (!displayedIds.has(file.id) && !pickedIds.has(file.id)) {
          leftovers.push(file)
        }
      }
    }
    for (const file of shuffle(leftovers)) {
      picked.push(file)
      pickedIds.add(file.id)
      if (picked.length >= batchSize) return picked
    }
  }

  return picked
}

export function pickSlotReplacement(
  mediaPool: MediaFile[],
  onScreenIds: Set<string>,
  tried: Set<string>,
  kind?: MediaKind,
): MediaFile | null {
  const available = mediaPool.filter((file) => !tried.has(file.id))
  if (available.length === 0) return null

  const offScreen = available.filter((file) => !onScreenIds.has(file.id))
  const pool = offScreen.length > 0 ? offScreen : available

  // If a specific kind is requested (e.g., video for video slot), prefer that kind first
  if (kind) {
    const sameKind = pool.filter((file) => file.kind === kind)
    if (sameKind.length > 0) {
      return sameKind[0]
    }
  }

  // Fallback: prefer images if available, otherwise any file
  const image = pool.find((file) => file.kind === 'image')
  if (image) return image

  return pool[0] ?? null
}
