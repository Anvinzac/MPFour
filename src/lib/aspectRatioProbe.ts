import { DEFAULT_ASPECT_RATIO } from '../types'
import type { MediaKind } from '../types'

const CONCURRENCY = 2

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

  private drain(): void {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) break
      this.active++
      this.probe(item).finally(() => {
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

  private async probe({ id, handle, kind }: QueueItem): Promise<void> {
    if (this.cache.has(id)) return

    const file = await handle.getFile()
    const url = URL.createObjectURL(file)

    try {
      const ratio =
        kind === 'image'
          ? await this.readImageMetadata(url)
          : await this.readVideoMetadata(url)
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
