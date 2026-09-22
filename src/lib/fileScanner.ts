import type { MediaFile } from '../types'
import { MAX_FILE_BYTES } from './constants'
import { getMediaKind, isGalleryMediaFile } from './mediaExtensions'
import { filterPlayableMedia } from './mediaValidator'

export interface ScanResult {
  files: MediaFile[]
  skippedOverLimit: number
  skippedUnplayable: number
}

export function formatScanSkipNotice(
  skippedOverLimit: number,
  skippedUnplayable: number,
): string | null {
  const parts: string[] = []
  if (skippedOverLimit > 0) {
    parts.push(
      `${skippedOverLimit} file${skippedOverLimit === 1 ? '' : 's'} over 100 MB`,
    )
  }
  if (skippedUnplayable > 0) {
    parts.push(
      `${skippedUnplayable} file${skippedUnplayable === 1 ? '' : 's'} not playable in this browser`,
    )
  }
  if (parts.length === 0) return null
  return `Skipped ${parts.join(' and ')}`
}

function createMediaId(file: File, relativePath: string): string {
  return `${relativePath}:${file.size}:${file.lastModified}`
}

export function isFileWithinLimit(size: number): boolean {
  return size <= MAX_FILE_BYTES
}

/**
 * Recursively walks all sub-folders under `dir` and collects media files.
 * Skips any file larger than {@link MAX_FILE_BYTES}.
 */
export async function scanDirectory(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  basePath = '',
): Promise<ScanResult> {
  const files: MediaFile[] = []
  let skippedOverLimit = 0

  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && isGalleryMediaFile(entry.name)) {
      const kind = getMediaKind(entry.name)
      if (!kind) continue

      const file = await entry.getFile()
      if (!isFileWithinLimit(file.size)) {
        skippedOverLimit++
        continue
      }

      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name
      files.push({
        id: createMediaId(file, relativePath),
        handle: entry,
        name: entry.name,
        relativePath,
        kind,
        folderId,
      })
    } else if (entry.kind === 'directory') {
      const nestedPath = basePath ? `${basePath}/${entry.name}` : entry.name
      const nested = await scanDirectory(entry, folderId, nestedPath)
      files.push(...nested.files)
      skippedOverLimit += nested.skippedOverLimit
    }
  }

  return { files, skippedOverLimit, skippedUnplayable: 0 }
}

/**
 * Walks the folder tree, applies the size limit, then probes survivors so only
 * browser-playable media enters the gallery.
 */
export async function scanAndValidateDirectory(
  dir: FileSystemDirectoryHandle,
  folderId: string,
  basePath = '',
): Promise<ScanResult> {
  const scan = await scanDirectory(dir, folderId, basePath)
  const validated = await filterPlayableMedia(scan.files)
  return {
    files: validated.files,
    skippedOverLimit: scan.skippedOverLimit,
    skippedUnplayable: validated.skippedUnplayable,
  }
}

/**
 * Well-known startIn locations the File System Access API can jump the
 * native picker to. `'home'` is the OS home directory — closest thing to a
 * "root" we can offer the browser. Not all browsers implement every preset;
 * {@link pickDirectory} feature-detects and falls back to the default picker.
 */
export type PickerStartIn =
  | 'home'
  | 'documents'
  | 'downloads'
  | 'desktop'
  | 'music'
  | 'pictures'
  | 'videos'

export async function pickDirectory(
  startIn?: PickerStartIn | FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  const options: Parameters<typeof window.showDirectoryPicker>[0] = {
    mode: 'read',
  }
  if (startIn) {
    // `'home'` is part of our PickerStartIn union but not in the lib's typings
    // for `startIn` (Chromium's union omits it). The runtime accepts the full
    // File System Access spec, so we cast through `unknown`.
    options.startIn = startIn as unknown as NonNullable<
      Parameters<typeof window.showDirectoryPicker>[0]
    >['startIn']
  }
  return window.showDirectoryPicker(options)
}

export interface DirectoryListing {
  directories: { name: string; handle: FileSystemDirectoryHandle }[]
  mediaCount: number
}

/**
 * Lightweight directory listing for the file-tree UI: just folder names and
 * a media count (no recursive walk, no handle decoding). Iterating
 * `dir.values()` only resolves the directory handles' names lazily, so we
 * still have to await every entry to count files — but it's a single
 * shallow pass and far cheaper than {@link scanDirectory}.
 */
export async function listDirectory(
  dir: FileSystemDirectoryHandle,
): Promise<DirectoryListing> {
  const directories: DirectoryListing['directories'] = []
  let mediaCount = 0

  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      directories.push({ name: entry.name, handle: entry })
    } else if (entry.kind === 'file' && isGalleryMediaFile(entry.name)) {
      mediaCount++
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name))
  return { directories, mediaCount }
}

/**
 * Resolves a subfolder path (e.g. `Documents/Vacation`) within an already
 * granted root handle and returns its directory handle. The caller is
 * responsible for kicking off the scan via `ingestFolder` so the subfolder
 * joins the same pool as roots picked via the native dialog.
 */
export async function resolveSubfolder(
  root: FileSystemDirectoryHandle,
  subPath: string,
): Promise<FileSystemDirectoryHandle> {
  const segments = subPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  let current = root
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: false })
  }
  return current
}

export function dedupeMediaFiles(files: MediaFile[]): MediaFile[] {
  const seen = new Set<string>()
  const unique: MediaFile[] = []

  for (const file of files) {
    if (seen.has(file.id)) continue
    seen.add(file.id)
    unique.push(file)
  }

  return unique
}

export function filterByFolder(
  files: MediaFile[],
  folderId: string,
): MediaFile[] {
  return files.filter((file) => file.folderId !== folderId)
}

export function countByKind(files: MediaFile[]): {
  images: number
  videos: number
} {
  let images = 0
  let videos = 0
  for (const file of files) {
    if (file.kind === 'image') images++
    else videos++
  }
  return { images, videos }
}
