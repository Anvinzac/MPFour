import {
  BACKGROUND_SCAN_BATCH_SIZE,
  QUICK_SCAN_FILES_PER_SUBDIR,
  QUICK_SCAN_MAX_FILES,
  QUICK_SCAN_MAX_SUBDIRS,
  QUICK_SCAN_NESTED_SUBDIRS,
} from './constants'
import {
  classifyScanChannel,
  getMediaKind,
  type ScanChannel,
} from './mediaExtensions'
import { filterPlayableMedia } from './mediaValidator'
import { shuffle } from './shuffle'
import type { MediaFile } from '../types'
import type { ScanResult } from './fileScanner'
import { isFileWithinLimit } from './fileScanner'

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

interface LevelScanResult {
  gallery: MediaFile[]
  legacy: MediaFile[]
  subdirs: SubdirEntry[]
  skippedOverLimit: number
}

async function scanDirectoryLevel(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  basePath: string,
): Promise<LevelScanResult> {
  const gallery: MediaFile[] = []
  const legacy: MediaFile[] = []
  const subdirs: SubdirEntry[] = []
  let skippedOverLimit = 0

  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      const channel = classifyScanChannel(entry.name)
      if (!channel) continue

      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name
      const parsed = await mediaFileFromEntry(entry, folderId, relativePath)
      skippedOverLimit += parsed.skippedOverLimit
      if (!parsed.file) continue

      if (channel === 'gallery') gallery.push(parsed.file)
      else legacy.push(parsed.file)
    } else if (entry.kind === 'directory') {
      const path = basePath ? `${basePath}/${entry.name}` : entry.name
      subdirs.push({ handle: entry, path })
    }
  }

  return { gallery, legacy, subdirs, skippedOverLimit }
}

interface ChannelBuckets {
  gallery: MediaFile[]
  legacy: MediaFile[]
}

function emptyBuckets(): ChannelBuckets {
  return { gallery: [], legacy: [] }
}

function addToChannelBuckets(
  buckets: ChannelBuckets,
  channel: ScanChannel,
  items: MediaFile[],
  cap: number,
  seen: Set<string>,
): void {
  const list = buckets[channel]
  for (const item of items) {
    if (seen.has(item.id)) continue
    if (list.length >= cap) break
    seen.add(item.id)
    list.push(item)
  }
}

async function collectQuickSample(
  dir: FileSystemDirectoryHandle,
  folderId: string,
): Promise<{ buckets: ChannelBuckets; skippedOverLimit: number }> {
  const root = await scanDirectoryLevel(dir, folderId, '')
  let skippedOverLimit = root.skippedOverLimit
  const buckets = emptyBuckets()
  const seen = new Set<string>()

  const addBoth = (level: LevelScanResult, galleryLimit: number) => {
    addToChannelBuckets(buckets, 'gallery', level.gallery, galleryLimit, seen)
    addToChannelBuckets(
      buckets,
      'legacy',
      level.legacy,
      QUICK_SCAN_MAX_FILES,
      seen,
    )
  }

  const rootBudget = Math.max(
    QUICK_SCAN_MAX_FILES - QUICK_SCAN_FILES_PER_SUBDIR * 2,
    Math.floor(QUICK_SCAN_MAX_FILES / 2),
  )
  addBoth(
    {
      gallery: shuffle(root.gallery).slice(0, rootBudget),
      legacy: shuffle(root.legacy).slice(0, rootBudget),
      subdirs: root.subdirs,
      skippedOverLimit: 0,
    },
    rootBudget,
  )

  const subdirsToVisit = shuffle(root.subdirs).slice(0, QUICK_SCAN_MAX_SUBDIRS)

  for (const subdir of subdirsToVisit) {
    if (
      buckets.gallery.length >= QUICK_SCAN_MAX_FILES &&
      buckets.legacy.length >= QUICK_SCAN_MAX_FILES
    ) {
      break
    }

    const level = await scanDirectoryLevel(subdir.handle, folderId, subdir.path)
    skippedOverLimit += level.skippedOverLimit
    addBoth(
      {
        gallery: level.gallery.slice(0, QUICK_SCAN_FILES_PER_SUBDIR),
        legacy: level.legacy.slice(0, QUICK_SCAN_FILES_PER_SUBDIR),
        subdirs: level.subdirs,
        skippedOverLimit: 0,
      },
      QUICK_SCAN_MAX_FILES,
    )

    for (const nested of shuffle(level.subdirs).slice(
      0,
      QUICK_SCAN_NESTED_SUBDIRS,
    )) {
      if (
        buckets.gallery.length >= QUICK_SCAN_MAX_FILES &&
        buckets.legacy.length >= QUICK_SCAN_MAX_FILES
      ) {
        break
      }
      const peek = await scanDirectoryLevel(nested.handle, folderId, nested.path)
      skippedOverLimit += peek.skippedOverLimit
      addBoth(
        {
          gallery: peek.gallery.slice(0, 2),
          legacy: peek.legacy.slice(0, 2),
          subdirs: [],
          skippedOverLimit: 0,
        },
        QUICK_SCAN_MAX_FILES,
      )
    }
  }

  return { buckets, skippedOverLimit }
}

async function validateChannel(
  channel: ScanChannel,
  files: MediaFile[],
): Promise<{ files: MediaFile[]; skippedUnplayable: number }> {
  if (channel === 'legacy' || files.length === 0) {
    return { files, skippedUnplayable: 0 }
  }
  const validated = await filterPlayableMedia(files)
  return {
    files: validated.files,
    skippedUnplayable: validated.skippedUnplayable,
  }
}

async function walkDirectory(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  basePath: string,
  seenIds: Set<string>,
  onRawFile: (file: MediaFile, channel: ScanChannel) => Promise<void>,
  onSkippedOverLimit: (count: number) => void,
  isAborted: () => boolean,
): Promise<void> {
  for await (const entry of dir.values()) {
    if (isAborted()) return

    if (entry.kind === 'file') {
      const channel = classifyScanChannel(entry.name)
      if (!channel) continue

      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name
      const parsed = await mediaFileFromEntry(entry, folderId, relativePath)
      if (parsed.skippedOverLimit > 0) onSkippedOverLimit(parsed.skippedOverLimit)
      if (!parsed.file || seenIds.has(parsed.file.id)) continue
      await onRawFile(parsed.file, channel)
    } else if (entry.kind === 'directory') {
      const nestedPath = basePath ? `${basePath}/${entry.name}` : entry.name
      await walkDirectory(
        entry,
        folderId,
        nestedPath,
        seenIds,
        onRawFile,
        onSkippedOverLimit,
        isAborted,
      )
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
  const galleryValidated = await validateChannel('gallery', raw.buckets.gallery)
  const legacyValidated = await validateChannel('legacy', raw.buckets.legacy)

  return {
    gallery: {
      files: galleryValidated.files,
      skippedOverLimit: raw.skippedOverLimit,
      skippedUnplayable: galleryValidated.skippedUnplayable,
    },
    legacy: {
      files: legacyValidated.files,
      skippedOverLimit: 0,
      skippedUnplayable: legacyValidated.skippedUnplayable,
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
    const novel = raw.filter((file) => !seen.has(file.id))
    if (novel.length === 0) return

    const validated = await validateChannel(channel, novel)
    totals[channel].skippedUnplayable += validated.skippedUnplayable

    const fresh = validated.files.filter((file) => !seen.has(file.id))
    for (const file of fresh) {
      seen.add(file.id)
      totals[channel].files.push(file)
    }

    if (fresh.length > 0) {
      const batch: ScanResult = {
        files: fresh,
        skippedOverLimit: 0,
        skippedUnplayable: validated.skippedUnplayable,
      }
      if (channel === 'gallery') {
        await callbacks.onGalleryBackground(batch)
      } else {
        await callbacks.onLegacyBackground(batch)
      }
    }
  }

  const flush = async () => {
    if (isAborted(signal)) throw new DOMException('Aborted', 'AbortError')
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
    '',
    allSeen,
    async (file, channel) => {
      const seen = channel === 'gallery' ? gallerySeen : legacySeen
      if (seen.has(file.id)) return
      pending[channel].push(file)
      const pendingCount = pending.gallery.length + pending.legacy.length
      if (pendingCount >= BACKGROUND_SCAN_BATCH_SIZE) {
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

/** One filesystem walk: gallery (images + mp4/m4v/webm) and legacy (mkv/avi/wmv). */
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
