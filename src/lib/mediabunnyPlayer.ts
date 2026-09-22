import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  type WrappedCanvas,
} from 'mediabunny'
import {
  CANVAS_SLOT_TIMEOUT_MS,
  MAX_ACTIVE_CANVAS_PLAYERS,
  PREVIEW_DURATION_SEC,
} from './constants'

let activeCanvasPlayers = 0
const slotWaitQueue: Array<() => void> = []
const countListeners = new Set<() => void>()

function notifyCountChange(): void {
  for (const listener of countListeners) listener()
}

export function getActiveCanvasPlayerCount(): number {
  return activeCanvasPlayers
}

export function subscribeCanvasPlayerCount(listener: () => void): () => void {
  countListeners.add(listener)
  return () => countListeners.delete(listener)
}

export function canStartCanvasPlayer(): boolean {
  return activeCanvasPlayers < MAX_ACTIVE_CANVAS_PLAYERS
}

function reserveCanvasSlot(timeoutMs = CANVAS_SLOT_TIMEOUT_MS): Promise<void> {
  if (canStartCanvasPlayer()) {
    activeCanvasPlayers++
    notifyCountChange()
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    let resolver: () => void

    const timer = window.setTimeout(() => {
      const idx = slotWaitQueue.indexOf(resolver)
      if (idx >= 0) slotWaitQueue.splice(idx, 1)
      reject(new Error('canvas slot timeout'))
    }, timeoutMs)

    resolver = () => {
      window.clearTimeout(timer)
      activeCanvasPlayers++
      notifyCountChange()
      resolve()
    }

    slotWaitQueue.push(resolver)
  })
}

function releaseCanvasSlot(): void {
  activeCanvasPlayers = Math.max(0, activeCanvasPlayers - 1)
  notifyCountChange()
  const next = slotWaitQueue.shift()
  if (next) next()
}

export interface CanvasPlayerMountOptions {
  /** Grid cells use the pool; fullscreen bypasses it. */
  usePoolSlot?: boolean
  /** Loop the entire clip (fullscreen). Grid defaults to a short preview window. */
  loopFull?: boolean
  loopSeconds?: number
}

/** Uses WebCodecs via Mediabunny — more reliable than <video> for mixed codecs/containers. */
export async function probeMediabunnyDecodable(file: File): Promise<boolean> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })

  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return false
    return await track.canDecode()
  } catch {
    return false
  } finally {
    input.dispose()
  }
}

export class CanvasGridPlayer {
  private input: Input | null = null
  private sink: CanvasSink | null = null
  private rafId = 0
  private playing = false
  private ticking = false
  private startMs = 0
  private loopEndSec = PREVIEW_DURATION_SEC
  private displayCanvas: HTMLCanvasElement | null = null
  private ownsSlot = false
  private disposed = false
  private frameCount = 0

  async mount(
    file: File,
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    options: CanvasPlayerMountOptions = {},
  ): Promise<void> {
    this.dispose()
    this.disposed = false

    const usePoolSlot = options.usePoolSlot !== false
    if (usePoolSlot) {
      await reserveCanvasSlot()
      // dispose() may have run while we were waiting for a slot. If so,
      // release the slot we just acquired so it doesn't leak and block
      // every future player.
      if (this.disposed) {
        releaseCanvasSlot()
        return
      }
      this.ownsSlot = true
    }

    try {
      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS,
      })

      const track = await input.getPrimaryVideoTrack()
      if (!track) {
        input.dispose()
        throw new Error('no video track')
      }

      const decodable = await track.canDecode()
      if (!decodable) {
        input.dispose()
        throw new Error('codec not decodable')
      }

      const duration = await input.computeDuration()
      const loopTarget = options.loopFull
        ? duration > 0
          ? duration
          : PREVIEW_DURATION_SEC
        : (options.loopSeconds ??
          Math.min(
            PREVIEW_DURATION_SEC,
            duration > 0 ? duration : PREVIEW_DURATION_SEC,
          ))
      this.loopEndSec = Math.max(0.1, loopTarget)

      const sink = new CanvasSink(track, {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
        fit: 'cover',
        poolSize: 2,
      })

      this.input = input
      this.sink = sink
      this.displayCanvas = canvas
    } catch (err) {
      if (this.ownsSlot) {
        this.ownsSlot = false
        releaseCanvasSlot()
      }
      throw err
    }
  }

  async showFirstFrame(): Promise<void> {
    if (!this.sink || !this.displayCanvas) return
    const wrapped = await this.sink.getCanvas(0)
    if (wrapped) this.blit(wrapped)
  }

  play(): void {
    if (!this.sink || !this.displayCanvas || this.playing) return
    this.playing = true
    this.startMs = performance.now()
    this.scheduleFrame()
  }

  stop(): void {
    this.playing = false
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  /** Number of frames successfully blitted to the display canvas. */
  getFrameCount(): number {
    return this.frameCount
  }

  isPlaying(): boolean {
    return this.playing
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    if (this.ownsSlot) {
      this.ownsSlot = false
      releaseCanvasSlot()
    }
    this.input?.dispose()
    this.input = null
    this.sink = null
    this.displayCanvas = null
  }

  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame(() => {
      void this.tick()
    })
  }

  private async tick(): Promise<void> {
    if (!this.playing || !this.sink || !this.displayCanvas) return
    if (this.ticking) {
      this.scheduleFrame()
      return
    }

    this.ticking = true
    try {
      const elapsedSec =
        ((performance.now() - this.startMs) / 1000) % this.loopEndSec
      const wrapped = await this.sink.getCanvas(elapsedSec)
      if (wrapped && this.playing) {
        this.blit(wrapped)
      }
    } catch {
      this.playing = false
      try {
        await this.showFirstFrame()
      } catch {
        // keep last painted frame
      }
    } finally {
      this.ticking = false
      if (this.playing) this.scheduleFrame()
    }
  }

  private blit(wrapped: WrappedCanvas): void {
    const canvas = this.displayCanvas
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(wrapped.canvas, 0, 0, canvas.width, canvas.height)
    this.frameCount++
  }
}
