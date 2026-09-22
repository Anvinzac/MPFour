import { calculatePreloadIndexRange } from './viewport'
import { isFileWithinLimit } from './fileScanner'
import type { MediaFile, MediaKind } from '../types'

interface CacheEntry {
  url: string
  handle: FileSystemFileHandle
  kind: MediaKind
}

class MediaPreloader {
  private cache = new Map<string, CacheEntry>()
  private lru: string[] = []
  private readyIds = new Set<string>()
  private warmImages = new Map<string, HTMLImageElement>()
  private inflight = new Map<string, Promise<string | null>>()
  private maxCacheSize = 20

  isReady(id: string): boolean {
    return this.readyIds.has(id) && this.cache.has(id)
  }

  get(id: string): string | null {
    const entry = this.cache.get(id)
    if (!entry) return null
    this.touch(id)
    return entry.url
  }

  /** Number of items currently held in the blob URL cache. */
  get size(): number {
    return this.cache.size
  }

  /** Largest cache size the LRU will grow to (driven by the active+lookahead window). */
  get maxSize(): number {
    return this.maxCacheSize
  }

  async prepare(
    id: string,
    handle: FileSystemFileHandle,
    kind: MediaKind,
  ): Promise<string | null> {
    if (kind === 'video') {
      return null
    }

    if (this.isReady(id)) {
      this.touch(id)
      return this.cache.get(id)!.url
    }

    const pending = this.inflight.get(id)
    if (pending) return pending

    const task = this.doPrepare(id, handle, kind)
    this.inflight.set(id, task)
    try {
      return await task
    } finally {
      this.inflight.delete(id)
    }
  }

  private async doPrepare(
    id: string,
    handle: FileSystemFileHandle,
    kind: MediaKind,
  ): Promise<string | null> {
    try {
      this.evictIfNeeded(id)

      let entry = this.cache.get(id)
      if (!entry) {
        const file = await handle.getFile()
        if (!isFileWithinLimit(file.size)) {
          return null
        }

        const url = URL.createObjectURL(file)
        entry = { url, handle, kind }
        this.cache.set(id, entry)
        this.touch(id)
      }

      await this.warmImageReady(id, entry.url)

      this.readyIds.add(id)
      return entry.url
    } catch {
      this.readyIds.delete(id)
      return null
    }
  }

  syncWindow(items: MediaFile[], startIndex: number, stopIndex: number): void {
    const { from, to, maxCache } = calculatePreloadIndexRange(
      startIndex,
      stopIndex,
      items.length,
    )
    this.maxCacheSize = Math.max(maxCache, this.maxCacheSize)

    for (let i = from; i <= to; i++) {
      const item = items[i]
      if (item?.kind === 'image') {
        void this.prepare(item.id, item.handle, item.kind)
      }
    }
  }

  getPreloadRange(
    items: MediaFile[],
    startIndex: number,
    stopIndex: number,
  ): MediaFile[] {
    const { from, to } = calculatePreloadIndexRange(
      startIndex,
      stopIndex,
      items.length,
    )
    return items.slice(from, to + 1)
  }

  private warmImageReady(id: string, url: string): Promise<void> {
    const existing = this.warmImages.get(id)
    if (existing?.src === url && existing.complete && existing.naturalWidth > 0) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const img = existing ?? new Image()
      if (!existing) {
        this.warmImages.set(id, img)
      }

      const onLoad = () => {
        cleanup()
        void img.decode().then(resolve).catch(() => resolve())
      }
      const onError = () => {
        cleanup()
        reject(new Error('warm image failed'))
      }
      const cleanup = () => {
        img.removeEventListener('load', onLoad)
        img.removeEventListener('error', onError)
      }

      img.addEventListener('load', onLoad, { once: true })
      img.addEventListener('error', onError, { once: true })

      if (img.src !== url) {
        img.src = url
      } else if (img.complete) {
        onLoad()
      }
    })
  }

  private touch(id: string): void {
    const idx = this.lru.indexOf(id)
    if (idx >= 0) this.lru.splice(idx, 1)
    this.lru.push(id)
  }

  private evictIfNeeded(incomingId: string): void {
    while (this.lru.length >= this.maxCacheSize) {
      const oldest = this.lru.find((id) => id !== incomingId)
      if (!oldest) break
      this.evict(oldest)
    }
  }

  private evict(id: string): void {
    const entry = this.cache.get(id)
    if (entry) {
      URL.revokeObjectURL(entry.url)
      this.cache.delete(id)
    }

    this.readyIds.delete(id)
    this.inflight.delete(id)
    this.warmImages.delete(id)
    this.lru = this.lru.filter((item) => item !== id)
  }

  destroy(): void {
    for (const id of [...this.cache.keys()]) {
      this.evict(id)
    }
    this.warmImages.clear()
  }
}

export const mediaPreloader = new MediaPreloader()
