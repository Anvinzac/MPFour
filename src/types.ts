export type MediaKind = 'video' | 'image'

export interface MediaFile {
  id: string
  handle: FileSystemFileHandle
  /** File name only */
  name: string
  /** Path relative to the picked root folder, e.g. `vacation/clips/clip.mp4` */
  relativePath: string
  kind: MediaKind
  folderId: string
}

export interface ActiveFolder {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  fileCount: number
  imageCount: number
  videoCount: number
  addedAt: number
}

export interface StoredFolder {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  addedAt: number
  lastUsedAt: number
  fileCount: number
  imageCount: number
  videoCount: number
}

export const COLUMN_WIDTH = 520
export const DEFAULT_ASPECT_RATIO = 16 / 9

export type AppView = 'grid' | 'history' | 'legacy'

export interface MediaStats {
  images: number
  videos: number
  total: number
}

/** A masonry cell with a stable key so failed media can be swapped without remounting the slot. */
export interface GallerySlot {
  key: string
  media: MediaFile
  /** Use default 16:9 height instead of probing — for fallback replacements. */
  useFixedHeight: boolean
}

export type GalleryViewMode = 'mixed' | 'favorites' | 'subfolder'

export interface SubfolderFilter {
  folderId: string
  directoryPath: string
  label: string
}

export type GalleryView =
  | { mode: 'mixed' }
  | { mode: 'favorites' }
  | { mode: 'subfolder'; filter: SubfolderFilter }

export interface FavoriteRecord {
  media_id: string
  folder_id: string
  relative_path: string
  name: string
  kind: MediaKind
  root_folder_name: string
  created_at: number
}
