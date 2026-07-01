import type { MediaKind } from '../types'

/** Web-native video containers for the main gallery. */
export const WEB_SAFE_VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm'])

/** Container formats handled on the legacy video page. */
export const LEGACY_VIDEO_EXTENSIONS = new Set(['mkv', 'avi', 'wmv'])

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'svg',
])

export type ScanChannel = 'gallery' | 'legacy'

function getExtension(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return null
  return name.slice(dot + 1).toLowerCase()
}

export function isWebSafeVideoFile(name: string): boolean {
  const ext = getExtension(name)
  return ext !== null && WEB_SAFE_VIDEO_EXTENSIONS.has(ext)
}

export function isLegacyVideoFile(name: string): boolean {
  const ext = getExtension(name)
  return ext !== null && LEGACY_VIDEO_EXTENSIONS.has(ext)
}

export function isImageFile(name: string): boolean {
  const ext = getExtension(name)
  return ext !== null && IMAGE_EXTENSIONS.has(ext)
}

/** Files eligible for the main mixed gallery (photos + web-safe video). */
export function isGalleryMediaFile(name: string): boolean {
  return isImageFile(name) || isWebSafeVideoFile(name)
}

export function classifyScanChannel(name: string): ScanChannel | null {
  if (isGalleryMediaFile(name)) return 'gallery'
  if (isLegacyVideoFile(name)) return 'legacy'
  return null
}

export function getMediaKind(name: string): MediaKind | null {
  if (isWebSafeVideoFile(name) || isLegacyVideoFile(name)) return 'video'
  if (isImageFile(name)) return 'image'
  return null
}

/** @deprecated Use isGalleryMediaFile or classifyScanChannel */
export function isVideoFile(name: string): boolean {
  return isWebSafeVideoFile(name) || isLegacyVideoFile(name)
}

/** @deprecated Use isGalleryMediaFile */
export function isMediaFile(name: string): boolean {
  return isGalleryMediaFile(name) || isLegacyVideoFile(name)
}
