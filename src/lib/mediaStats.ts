import type { MediaFile, MediaStats } from '../types'

export function getMediaStats(pool: MediaFile[]): MediaStats {
  let images = 0
  let videos = 0

  for (const file of pool) {
    if (file.kind === 'image') images++
    else videos++
  }

  return { images, videos, total: pool.length }
}
