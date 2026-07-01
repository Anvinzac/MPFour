import type { MediaFile, MediaKind } from '../types'
import { probeMediabunnyDecodable } from './mediabunnyPlayer'

const CONCURRENCY = 2
const TIMEOUT_MS = 12_000

function probeImageUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(false)
    }, TIMEOUT_MS)

    const cleanup = () => {
      window.clearTimeout(timer)
      img.onload = null
      img.onerror = null
    }

    img.onload = () => {
      cleanup()
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0)
    }
    img.onerror = () => {
      cleanup()
      resolve(false)
    }
    img.src = url
  })
}

async function probeMediaFile(
  handle: FileSystemFileHandle,
  kind: MediaKind,
): Promise<boolean> {
  const file = await handle.getFile()

  if (kind === 'image') {
    const url = URL.createObjectURL(file)
    try {
      return await probeImageUrl(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return probeMediabunnyDecodable(file)
}

async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  )
  return results
}

/**
 * Probes each file. Videos use Mediabunny + WebCodecs (canDecode) instead of
 * fragile <video> blob playback.
 */
export async function filterPlayableMedia(
  files: MediaFile[],
): Promise<{ files: MediaFile[]; skippedUnplayable: number }> {
  if (files.length === 0) {
    return { files: [], skippedUnplayable: 0 }
  }

  const results = await runPool(files, CONCURRENCY, async (media) => {
    const ok = await probeMediaFile(media.handle, media.kind)
    return ok ? media : null
  })

  const kept = results.filter((file): file is MediaFile => file !== null)
  return {
    files: kept,
    skippedUnplayable: files.length - kept.length,
  }
}
