import {
  BACKGROUND_SCAN_BATCH_SIZE,
  BACKGROUND_SCAN_FLUSH_MS,
  QUICK_SCAN_MAX_DIRS,
  QUICK_SCAN_MAX_FILES,
  SCAN_DIR_CONCURRENCY,
  SCAN_FILE_CONCURRENCY,
} from './constants'
import { isImagesOnly } from './scanPreferences'
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
    } else if (entry.kind === 'directory' && !isSkippedDirectory(entry.name)) {
      subdirs.push({ handle: entry, path })
    }
  }

  return { files: shuffle(files), subdirs }
}

/** System, cache and tooling folders that hold huge trees but no user media. */
const SKIPPED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'bower_components',
  '__pycache__',
  '__macosx',
  '$recycle.bin',
  'system volume information',
  'appdata',
  'programdata',
  'program files',
  'program files (x86)',
  'windows',
])
const SKIPPED_BUNDLE_SUFFIXES = ['.app', '.framework', '.bundle', '.xcodeproj']

function isSkippedDirectory(name: string): boolean {
  if (name.startsWith('.')) return true
  const lower = name.toLowerCase()
  if (SKIPPED_DIRECTORY_NAMES.has(lower)) return true
  return SKIPPED_BUNDLE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/** Runs `fn` over `items` with at most `limit` calls in flight, preserving order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Parallel random-order traversal: SCAN_DIR_CONCURRENCY workers share one
 * frontier, and sub-directories are queued before a directory's files are
 * processed, so idle workers dive deeper immediately. Unreadable
 * directories are skipped instead of aborting the scan.
 */
async function crawl(
  root: FileSystemDirectoryHandle,
  onDirectory: (files: ListedFile[]) => Promise<void>,
  shouldStop: (visited: number) => boolean,
): Promise<void> {
  const frontier: SubdirEntry[] = [{ handle: root, path: '' }]
  const waiters: Array<() => void> = []
  let active = 0
  let visited = 0

  const wakeAll = () => {
    for (const wake of waiters.splice(0)) wake()
  }

  const worker = async () => {
    for (;;) {
      if (shouldStop(visited)) return
      if (frontier.length === 0) {
        if (active === 0) return
        await new Promise<void>((resolve) => waiters.push(resolve))
        continue
      }
      const current = takeRandom(frontier)
      visited++
      active++
      try {
        const listing = await listDirectory(current.handle, current.path)
        frontier.push(...listing.subdirs)
        wakeAll()
        await onDirectory(listing.files)
      } catch {
        // permission denied / vanished directory
      } finally {
        active--
        wakeAll()
      }
    }
  }

  await Promise.all(Array.from({ length: SCAN_DIR_CONCURRENCY }, worker))
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

/** Quick pass may visit up to this many × QUICK_SCAN_MAX_DIRS while nothing is found. */
const QUICK_SCAN_DEEP_FACTOR = 4

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
  const imagesOnly = isImagesOnly()

  const full = () =>
    buckets.gallery.length >= QUICK_SCAN_MAX_FILES &&
    (imagesOnly || buckets.legacy.length >= QUICK_SCAN_MAX_FILES)

  await crawl(
    dir,
    async (files) => {
      const quota = { gallery: rollDirectoryQuota(), legacy: rollDirectoryQuota() }
      for (const listed of files) {
        const list = buckets[listed.channel]
        if (quota[listed.channel] === 0 || list.length >= QUICK_SCAN_MAX_FILES) continue
        const parsed = await mediaFileFromEntry(listed.handle, folderId, listed.relativePath)
        skippedOverLimit += parsed.skippedOverLimit
        if (!parsed.file) continue
        list.push(parsed.file)
        quota[listed.channel]--
        if (quota.gallery === 0 && quota.legacy === 0) break
      }
    },
    (visited) => {
      if (full()) return true
      if (visited < QUICK_SCAN_MAX_DIRS) return false
      // Media buried deep under empty levels: keep digging a while longer
      // so the first screen isn't empty, then hand off to the background scan.
      const found = buckets.gallery.length + buckets.legacy.length
      return found > 0 || visited >= QUICK_SCAN_MAX_DIRS * QUICK_SCAN_DEEP_FACTOR
    },
  )

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
  await crawl(
    dir,
    async (files) => {
      const parsed = await mapLimit(files, SCAN_FILE_CONCURRENCY, async (listed) =>
        isAborted()
          ? null
          : {
              ...(await mediaFileFromEntry(listed.handle, folderId, listed.relativePath)),
              channel: listed.channel,
            },
      )
      for (const result of parsed) {
        if (!result || isAborted()) return
        if (result.skippedOverLimit > 0) onSkippedOverLimit(result.skippedOverLimit)
        if (!result.file || seenIds.has(result.file.id)) continue
        await onRawFile(result.file, result.channel)
      }
    },
    () => isAborted(),
  )
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
  // Crawl workers call flush concurrently; chain them so batches reach the
  // callbacks one at a time and in order.
  let flushChain: Promise<void> = Promise.resolve()
  const flush = () => {
    const run = flushChain.then(async () => {
      if (isAborted(signal)) throw new DOMException('Aborted', 'AbortError')
      lastFlushAt = Date.now()
      totals.gallery.skippedOverLimit += pendingSkippedOverLimit
      totals.legacy.skippedOverLimit += pendingSkippedOverLimit
      pendingSkippedOverLimit = 0
      await flushChannel('gallery')
      await flushChannel('legacy')
    })
    flushChain = run.catch(() => {})
    return run
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
