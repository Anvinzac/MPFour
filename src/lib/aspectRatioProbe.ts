import { DEFAULT_ASPECT_RATIO } from '../types'
import type { MediaKind } from '../types'

const CONCURRENCY = 6
/** Per-file metadata probe timeout — prevents a hung probe from blocking the grid. */
const PROBE_TIMEOUT_MS = 8000

type Listener = () => void

interface QueueItem {
  id: string
  handle: FileSystemFileHandle
  kind: MediaKind
}

class AspectRatioProbe {
  private cache = new Map<string, number>()
  private queue: QueueItem[] = []
  private active = 0
  private listeners = new Set<Listener>()
  private _version = 0

  get version(): number {
    return this._version
  }

  get(id: string): number {
    return this.cache.get(id) ?? DEFAULT_ASPECT_RATIO
  }

  has(id: string): boolean {
    return this.cache.has(id)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(id: string, handle: FileSystemFileHandle, kind: MediaKind): void {
    if (this.cache.has(id)) return
    if (this.queue.some((item) => item.id === id)) return
    this.queue.push({ id, handle, kind })
    this.drain()
  }

  enqueueMany(items: QueueItem[]): void {
    for (const item of items) {
      this.enqueue(item.id, item.handle, item.kind)
    }
  }

  /**
   * Probe a batch of files and resolve only once every ratio is cached.
   * Used as a pre-check so cells are created with correct dimensions from
   * the first paint instead of guessing 16:9 and reflowing later.
   */
  async probeBatch(items: QueueItem[]): Promise<void> {
    const pending = items.filter((item) => !this.cache.has(item.id))
    if (pending.length === 0) return

    // Remove these from the async queue so the drain doesn't double-probe.
    const pendingIds = new Set(pending.map((item) => item.id))
    this.queue = this.queue.filter((item) => !pendingIds.has(item.id))

    let index = 0
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, pending.length) },
      async () => {
        while (index < pending.length) {
          const item = pending[index++]
          await this.probeItem(item)
        }
      },
    )
    await Promise.all(workers)
  }

  private drain(): void {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) break
      this.active++
      this.probeItem(item).finally(() => {
        this.active--
        this.drain()
      })
    }
  }

  private commit(id: string, ratio: number): void {
    this.cache.set(id, ratio)
    this._version++
    for (const listener of this.listeners) {
      listener()
    }
  }

  private async probeItem({ id, handle, kind }: QueueItem): Promise<void> {
    if (this.cache.has(id)) return

    const file = await handle.getFile()
    const url = URL.createObjectURL(file)

    try {
      const read =
        kind === 'image'
          ? this.readImageMetadata(url)
          : this.readVideoMetadata(url)
      const ratio = await Promise.race([
        read,
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error('aspect probe timeout')),
            PROBE_TIMEOUT_MS,
          ),
        ),
      ])
      this.commit(id, ratio)
    } catch {
      this.commit(id, DEFAULT_ASPECT_RATIO)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  private readImageMetadata(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const img = new Image()

      img.onload = () => {
        const ratio =
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight
            : DEFAULT_ASPECT_RATIO
        resolve(ratio)
      }

      img.onerror = () => reject(new Error('image metadata probe failed'))
      img.src = url
    })
  }

  private readVideoMetadata(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true

      const cleanup = () => {
        video.removeAttribute('src')
        video.load()
      }

      video.addEventListener(
        'loadedmetadata',
        () => {
          const ratio =
            video.videoWidth > 0 && video.videoHeight > 0
              ? video.videoWidth / video.videoHeight
              : DEFAULT_ASPECT_RATIO
          cleanup()
          resolve(ratio)
        },
        { once: true },
      )

      video.addEventListener(
        'error',
        () => {
          cleanup()
          reject(new Error('video metadata probe failed'))
        },
        { once: true },
      )

      video.src = url
    })
  }
}

export const aspectRatioProbe = new AspectRatioProbe()
