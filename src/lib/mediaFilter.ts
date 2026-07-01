import { dirname } from './pathUtils'
import type { MediaFile } from '../types'

export function filterFilesInSubfolder(
  files: MediaFile[],
  folderId: string,
  directoryPath: string,
): MediaFile[] {
  return files.filter((file) => {
    if (file.folderId !== folderId) return false
    return dirname(file.relativePath) === directoryPath
  })
}

export function filterFavoriteFiles(
  files: MediaFile[],
  favoriteIds: Set<string>,
): MediaFile[] {
  return files.filter((file) => favoriteIds.has(file.id))
}
