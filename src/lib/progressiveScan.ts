import {
  BACKGROUND_SCAN_BATCH_SIZE,
  BACKGROUND_SCAN_FLUSH_MS,
  QUICK_SCAN_MAX_DIRS,
  QUICK_SCAN_MAX_FILES,
} from './constants'
import {
  classifyScanChannel,
  getMediaKind,
  type ScanChannel,
} from './mediaExtensions'
import { rollDirectoryQuota } from './overviewSampler'
import { shuffle } from './shuffle'
import type { MediaFile } from '../types'
import type { ScanResult } from './fileScanner'
import { isFileLargeEnough, isFileWithinLimit } from './fileScanner'

function createMediaId(file: File, relativePath: string): string {
  return `${relativePath}:${file.size}:${file.lastModified}`
}

async function mediaFileFromEntry(
  entry: FileSystemFileHandle,
  folderId: string,
  relativePath: string,
): Promise<{ file: MediaFile | null; skippedOverLimit: number }> {
  const kind = getMediaKind(entry.name)
  if (!kind) return { file: null, skippedOverLimit: 0 }

  const file = await entry.getFile()
  if (!isFileWithinLimit(file.size)) {
    return { file: null, skippedOverLimit: 1 }
  }
  if (!isFileLargeEnough(file.size)) {
    return { file: null, skippedOverLimit: 0 }
  }

  return {
    file: {
      id: createMediaId(file, relativePath),
      handle: entry,
      name: entry.name,
      relativePath,
      kind,
      folderId,
    },
    skippedOverLimit: 0,
  }
}

interface SubdirEntry {
  handle: FileSystemDirectoryHandle
  path: string
}

interface ListedFile {
  handle: FileSystemFileHandle
  channel: ScanChannel
  relativePath: string
}

/** One directory's media entries (shuffled) and sub-directories, without reading any file. */
async function listDirectory(
  dir: FileSystemDirectoryHandle,
  basePath: string,
): Promise<{ files: ListedFile[]; subdirs: SubdirEntry[] }> {
  const files: ListedFile[] = []
  const subdirs: SubdirEntry[] = []

  for await (const entry of dir.values()) {
    const path = basePath ? `${basePath}/${entry.name}` : entry.name
    if (entry.kind === 'file') {
      const channel = classifyScanChannel(entry.name)
      if (channel) files.push({ handle: entry, channel, relativePath: path })
    } else if (entry.kind === 'directory') {
      subdirs.push({ handle: entry, path })
    }
  }

  return { files: shuffle(files), subdirs }
}

/** Removes and returns a random directory so traversal wanders the tree instead of going depth-first. */
function takeRandom(frontier: SubdirEntry[]): SubdirEntry {
  const index = Math.floor(Math.random() * frontier.length)
  const picked = frontier[index]
  frontier[index] = frontier[frontier.length - 1]
  frontier.pop()
  return picked
}

interface ChannelBuckets {
  gallery: MediaFile[]
  legacy: MediaFile[]
}

function emptyBuckets(): ChannelBuckets {
  return { gallery: [], legacy: [] }
}

/**
 * Random walk over up to QUICK_SCAN_MAX_DIRS directories, taking a random
 * overview quota of files from each, so the first screen is a survey of the whole tree.
 */
async function collectQuickSample(
  dir: FileSystemDirectoryHandle,
  folderId: string,
): Promise<{ buckets: ChannelBuckets; skippedOverLimit: number }> {
  const buckets = emptyBuckets()
  let skippedOverLimit = 0
  const frontier: SubdirEntry[] = [{ handle: dir, path: '' }]
  let visited = 0

  const full = () =>
    buckets.gallery.length >= QUICK_SCAN_MAX_FILES &&
    buckets.legacy.length >= QUICK_SCAN_MAX_FILES

  while (frontier.length > 0 && visited < QUICK_SCAN_MAX_DIRS && !full()) {
    const current = takeRandom(frontier)
    visited++
    const listing = await listDirectory(current.handle, current.path)
    frontier.push(...listing.subdirs)

    const quota = { gallery: rollDirectoryQuota(), legacy: rollDirectoryQuota() }
    for (const listed of listing.files) {
      const list = buckets[listed.channel]
      if (quota[listed.channel] === 0 || list.length >= QUICK_SCAN_MAX_FILES) continue
      const parsed = await mediaFileFromEntry(listed.handle, folderId, listed.relativePath)
      skippedOverLimit += parsed.skippedOverLimit
      if (!parsed.file) continue
      list.push(parsed.file)
      quota[listed.channel]--
      if (quota.gallery === 0 && quota.legacy === 0) break
    }
  }

  return { buckets, skippedOverLimit }
}

/** Full scan in random directory order (files shuffled within each directory). */
async function walkDirectory(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  seenIds: Set<string>,
  onRawFile: (file: MediaFile, channel: ScanChannel) => Promise<void>,
  onSkippedOverLimit: (count: number) => void,
  isAborted: () => boolean,
): Promise<void> {
  const frontier: SubdirEntry[] = [{ handle: dir, path: '' }]

  while (frontier.length > 0) {
    if (isAborted()) return
    const current = takeRandom(frontier)
    const listing = await listDirectory(current.handle, current.path)
    frontier.push(...listing.subdirs)

    for (const listed of listing.files) {
      if (isAborted()) return
      const parsed = await mediaFileFromEntry(listed.handle, folderId, listed.relativePath)
      if (parsed.skippedOverLimit > 0) onSkippedOverLimit(parsed.skippedOverLimit)
      if (!parsed.file || seenIds.has(parsed.file.id)) continue
      await onRawFile(parsed.file, listed.channel)
    }
  }
}

export interface DualScanCallbacks {
  onGalleryQuick: (result: ScanResult) => void | Promise<void>
  onGalleryBackground: (result: ScanResult) => void | Promise<void>
  onLegacyQuick: (result: ScanResult) => void | Promise<void>
  onLegacyBackground: (result: ScanResult) => void | Promise<void>
}

export interface DualScanOptions extends DualScanCallbacks {
  signal?: AbortSignal
}

export interface DualScanTotals {
  gallery: ScanResult
  legacy: ScanResult
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false
}

export async function quickDualScanFolder(
  dir: FileSystemDirectoryHandle,
  folderId: string,
): Promise<{ gallery: ScanResult; legacy: ScanResult }> {
  const raw = await collectQuickSample(dir, folderId)

  return {
    gallery: {
      files: raw.buckets.gallery,
      skippedOverLimit: raw.skippedOverLimit,
      skippedUnplayable: 0,
    },
    legacy: {
      files: raw.buckets.legacy,
      skippedOverLimit: 0,
      skippedUnplayable: 0,
    },
  }
}

export async function backgroundDualScanFolder(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  gallerySeen: Set<string>,
  legacySeen: Set<string>,
  callbacks: Pick<
    DualScanCallbacks,
    'onGalleryBackground' | 'onLegacyBackground'
  >,
  signal?: AbortSignal,
): Promise<DualScanTotals> {
  const totals: DualScanTotals = {
    gallery: { files: [], skippedOverLimit: 0, skippedUnplayable: 0 },
    legacy: { files: [], skippedOverLimit: 0, skippedUnplayable: 0 },
  }

  const pending: ChannelBuckets = emptyBuckets()
  let pendingSkippedOverLimit = 0

  const flushChannel = async (channel: ScanChannel) => {
    const raw = pending[channel]
    if (raw.length === 0) return
    pending[channel] = []

    const seen = channel === 'gallery' ? gallerySeen : legacySeen
    const fresh = raw.filter((file) => !seen.has(file.id))
    for (const file of fresh) {
      seen.add(file.id)
      totals[channel].files.push(file)
    }

    if (fresh.length > 0) {
      const batch: ScanResult = {
        files: fresh,
        skippedOverLimit: 0,
        skippedUnplayable: 0,
      }
      if (channel === 'gallery') {
        await callbacks.onGalleryBackground(batch)
      } else {
        await callbacks.onLegacyBackground(batch)
      }
    }
  }

  let lastFlushAt = Date.now()
  const flush = async () => {
    if (isAborted(signal)) throw new DOMException('Aborted', 'AbortError')
    lastFlushAt = Date.now()
    totals.gallery.skippedOverLimit += pendingSkippedOverLimit
    totals.legacy.skippedOverLimit += pendingSkippedOverLimit
    pendingSkippedOverLimit = 0
    await flushChannel('gallery')
    await flushChannel('legacy')
  }

  const allSeen = new Set([...gallerySeen, ...legacySeen])

  await walkDirectory(
    dir,
    folderId,
    allSeen,
    async (file, channel) => {
      const seen = channel === 'gallery' ? gallerySeen : legacySeen
      if (seen.has(file.id)) return
      pending[channel].push(file)
      const pendingCount = pending.gallery.length + pending.legacy.length
      if (
        pendingCount >= BACKGROUND_SCAN_BATCH_SIZE ||
        Date.now() - lastFlushAt >= BACKGROUND_SCAN_FLUSH_MS
      ) {
        await flush()
      }
    },
    (count) => {
      pendingSkippedOverLimit += count
    },
    () => isAborted(signal),
  )

  await flush()
  return totals
}

/**
 * One filesystem walk: gallery (images + mp4/m4v/webm) and legacy (mkv/avi/wmv).
 * Files are emitted unvalidated so discovery never waits on decoding; the
 * gallery validates just the batch it is about to show.
 */
export async function progressiveDualScanFolder(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  options: DualScanOptions,
): Promise<DualScanTotals> {
  if (isAborted(options.signal)) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const quick = await quickDualScanFolder(dir, folderId)
  await options.onGalleryQuick(quick.gallery)
  await options.onLegacyQuick(quick.legacy)

  if (isAborted(options.signal)) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const gallerySeen = new Set(quick.gallery.files.map((f) => f.id))
  const legacySeen = new Set(quick.legacy.files.map((f) => f.id))

  const background = await backgroundDualScanFolder(
    dir,
    folderId,
    gallerySeen,
    legacySeen,
    {
      onGalleryBackground: options.onGalleryBackground,
      onLegacyBackground: options.onLegacyBackground,
    },
    options.signal,
  )

  return {
    gallery: {
      files: [...quick.gallery.files, ...background.gallery.files],
      skippedOverLimit:
        quick.gallery.skippedOverLimit + background.gallery.skippedOverLimit,
      skippedUnplayable:
        quick.gallery.skippedUnplayable +
        background.gallery.skippedUnplayable,
    },
    legacy: {
      files: [...quick.legacy.files, ...background.legacy.files],
      skippedOverLimit:
        quick.legacy.skippedOverLimit + background.legacy.skippedOverLimit,
      skippedUnplayable:
        quick.legacy.skippedUnplayable + background.legacy.skippedUnplayable,
    },
  }
}

/** @deprecated Use progressiveDualScanFolder */
export async function quickScanFolder(
  dir: FileSystemDirectoryHandle,
  folderId: string,
): Promise<ScanResult> {
  const result = await quickDualScanFolder(dir, folderId)
  return result.gallery
}

/** @deprecated Use progressiveDualScanFolder */
export async function progressiveScanFolder(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  options: {
    signal?: AbortSignal
    onQuickBatch: (result: ScanResult) => void | Promise<void>
    onBackgroundBatch: (result: ScanResult) => void | Promise<void>
  },
): Promise<ScanResult> {
  const totals = await progressiveDualScanFolder(dir, folderId, {
    signal: options.signal,
    onGalleryQuick: options.onQuickBatch,
    onGalleryBackground: options.onBackgroundBatch,
    onLegacyQuick: async () => {},
    onLegacyBackground: async () => {},
  })
  return totals.gallery
}

/** @deprecated Use progressiveDualScanFolder */
export async function backgroundScanFolder(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  seenIds: Set<string>,
  callbacks: { onBackgroundBatch: (result: ScanResult) => void | Promise<void> },
  signal?: AbortSignal,
): Promise<ScanResult> {
  const totals = await backgroundDualScanFolder(
    dir,
    folderId,
    seenIds,
    new Set(),
    {
      onGalleryBackground: callbacks.onBackgroundBatch,
      onLegacyBackground: async () => {},
    },
    signal,
  )
  return totals.gallery
}
