import { memo, useEffect, useRef, useState } from 'react'
import type { RenderComponentProps } from 'masonic'
import { useCellHeight } from '../hooks/useCellHeight'
import { useFullScreen } from '../hooks/useFullScreen'
import { useGalleryFallback } from '../hooks/useGalleryFallback'
import {
  LARGE_VIDEO_BYTES,
  MAX_AUTO_RECOVERIES,
  OFFSCREEN_RELEASE_MS,
  PLAYBACK_HEALTH_CHECK_INTERVAL_MS,
  PLAYBACK_STALL_THRESHOLD,
} from '../lib/constants'
import { CanvasGridPlayer, isSlotTimeout } from '../lib/mediabunnyPlayer'
import { PEEK_PLAYBACK_IO } from '../lib/mediaReady'
import { CellPathLabel } from './CellPathLabel'
import { CellComments } from './CellComments'
import { FavoriteButton } from './FavoriteButton'
import type { MediaFile } from '../types'

interface MediaCellProps extends RenderComponentProps<MediaFile> {
  slotKey: string
  useFixedHeight: boolean
  aspectRatio: number
}

const SLOT_RETRY_DELAY_MS = 500
const RECOVERY_BASE_DELAY_MS = 600

export const MediaCell = memo(function MediaCell({
  data,
  width,
  slotKey,
  useFixedHeight,
  aspectRatio,
}: MediaCellProps) {
  const cellRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const playerRef = useRef<CanvasGridPlayer | null>(null)
  const sizeRef = useRef({ width, height: 0 })
  // GalleryCell keys this component by slotKey+id+kind, so a fresh
  // instance (and a fresh failedRef) is mounted whenever the slot's media
  // changes — no manual reset effect needed (that was the source of a past
  // hook-order bug).
  const failedRef = useRef(false)
  // Once a file has played, later failures are transient (decoder reclaimed,
  // GPU pressure) and must not swap the file out from under the user.
  const playedOnceRef = useRef(false)
  const { openFullScreen } = useFullScreen()
  const { reportSlotFailed } = useGalleryFallback()
  const [isReady, setIsReady] = useState(false)
  const [isLargeFile, setIsLargeFile] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const height = useCellHeight(width, data.id, aspectRatio, useFixedHeight)
  sizeRef.current = { width, height }

  const reportFailedRef = useRef(reportSlotFailed)
  reportFailedRef.current = reportSlotFailed
  const mediaKindRef = useRef(data.kind)
  mediaKindRef.current = data.kind

  useEffect(() => {
    const el = cellRef.current
    if (!el) return

    let cancelled = false
    let loadId = 0
    let visible = false
    let autoRecoveries = 0
    let releaseTimer = 0
    let retryTimer = 0
    let healthTimer = 0

    const failSlot = () => {
      if (failedRef.current || cancelled) return
      failedRef.current = true
      reportFailedRef.current(slotKey, mediaKindRef.current)
    }

    const stopHealthCheck = () => {
      if (healthTimer) {
        window.clearInterval(healthTimer)
        healthTimer = 0
      }
    }

    // Keeps the canvas (and its last painted frame); only frees the decoder.
    const releasePlayer = () => {
      stopHealthCheck()
      loadId++
      playerRef.current?.dispose()
      playerRef.current = null
    }

    const clearTimers = () => {
      if (releaseTimer) window.clearTimeout(releaseTimer)
      if (retryTimer) window.clearTimeout(retryTimer)
      releaseTimer = 0
      retryTimer = 0
      stopHealthCheck()
    }

    const retryLater = (delayMs: number) => {
      if (retryTimer || cancelled) return
      retryTimer = window.setTimeout(() => {
        retryTimer = 0
        if (visible) void startPlayback()
      }, delayMs)
    }

    const recover = () => {
      if (cancelled) return
      releasePlayer()
      if (autoRecoveries >= MAX_AUTO_RECOVERIES) {
        setNeedsReload(true)
        return
      }
      autoRecoveries++
      retryLater(RECOVERY_BASE_DELAY_MS * autoRecoveries)
    }

    const startHealthCheck = (player: CanvasGridPlayer) => {
      stopHealthCheck()
      let lastFrames = player.getFrameCount()
      let stalledChecks = 0
      healthTimer = window.setInterval(() => {
        if (playerRef.current !== player || !player.isPlaying() || document.hidden) {
          return
        }
        const frames = player.getFrameCount()
        if (frames !== lastFrames) {
          lastFrames = frames
          stalledChecks = 0
          autoRecoveries = 0
          return
        }
        if (++stalledChecks >= PLAYBACK_STALL_THRESHOLD) recover()
      }, PLAYBACK_HEALTH_CHECK_INTERVAL_MS)
    }

    const onContextRestored = () => {
      // The browser wiped the canvas after a GPU reset; repaint from a fresh decoder.
      releasePlayer()
      if (visible) void startPlayback()
    }

    const startPlayback = async () => {
      const existing = playerRef.current
      if (existing && !existing.isFailed()) {
        existing.play()
        startHealthCheck(existing)
        return
      }
      if (existing) releasePlayer()

      const currentLoad = ++loadId
      const isStale = () => cancelled || currentLoad !== loadId
      let player: CanvasGridPlayer | null = null

      try {
        const file = await data.handle.getFile()
        if (isStale() || !cellRef.current) return

        setIsLargeFile(file.size > LARGE_VIDEO_BYTES)

        const { width: cellW, height: cellH } = sizeRef.current
        let canvas = canvasRef.current
        if (!canvas) {
          canvas = document.createElement('canvas')
          canvas.className = 'media-cell__canvas h-full w-full'
          canvas.addEventListener('contextrestored', onContextRestored)
          cellRef.current.appendChild(canvas)
          canvasRef.current = canvas
        }
        const targetW = Math.max(1, Math.round(cellW))
        const targetH = Math.max(1, Math.round(cellH))
        // Assigning width/height clears the canvas, so skip it when unchanged
        // to keep the last frame visible while the new decoder spins up.
        if (canvas.width !== targetW) canvas.width = targetW
        if (canvas.height !== targetH) canvas.height = targetH

        player = new CanvasGridPlayer()
        playerRef.current = player

        await player.mount(file, canvas, cellW, cellH)
        if (isStale()) {
          player.dispose()
          return
        }

        await player.showFirstFrame()
        if (isStale()) {
          player.dispose()
          return
        }

        const mounted = player
        mounted.onFailure(() => {
          if (playerRef.current === mounted) recover()
        })
        mounted.play()
        startHealthCheck(mounted)
        canvas.classList.add('media-cell__canvas--ready')
        playedOnceRef.current = true
        setNeedsReload(false)
        setIsReady(true)
      } catch (err) {
        player?.dispose()
        if (playerRef.current === player) playerRef.current = null
        if (isStale()) return

        if (isSlotTimeout(err)) {
          // Every decoder is busy; not the file's fault. Try again while visible.
          retryLater(SLOT_RETRY_DELAY_MS)
        } else if (playedOnceRef.current) {
          recover()
        } else {
          // A genuine decode/mount failure (unsupported codec, corrupt file,
          // etc.). Ask for a replacement so the slot doesn't sit blank forever.
          failSlot()
        }
      }
    }

    const playObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) {
        if (releaseTimer) {
          window.clearTimeout(releaseTimer)
          releaseTimer = 0
        }
        void startPlayback()
      } else if (!releaseTimer) {
        playerRef.current?.stop()
        stopHealthCheck()
        releaseTimer = window.setTimeout(() => {
          releaseTimer = 0
          if (!visible) releasePlayer()
        }, OFFSCREEN_RELEASE_MS)
      }
    }, PEEK_PLAYBACK_IO)

    playObserver.observe(el)

    return () => {
      cancelled = true
      clearTimers()
      playObserver.disconnect()
      releasePlayer()
      setIsReady(false)
      setIsLargeFile(false)
      canvasRef.current?.removeEventListener('contextrestored', onContextRestored)
      canvasRef.current?.remove()
      canvasRef.current = null
    }
  }, [data.id, data.handle, slotKey, reloadToken])

  const handleOpenFullScreen = () => {
    if (!isReady) return
    openFullScreen(data)
  }

  return (
    <div
      ref={cellRef}
      className="gallery-cell media-cell relative overflow-hidden rounded-lg bg-neutral-900"
      style={{ width, height, contain: 'layout style paint' }}
      title={data.relativePath}
    >
      <FavoriteButton file={data} />
      <CellComments file={data} />

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setNeedsReload(false)
          setReloadToken((token) => token + 1)
        }}
        className={`absolute right-2 top-2 z-[12] flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition ${
          needsReload
            ? 'bg-amber-500/90 text-neutral-950'
            : 'bg-black/50 text-neutral-200 hover:bg-black/70'
        }`}
        aria-label="Reload video"
        title="Reload video"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>

      {needsReload && (
        <span className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center text-xs text-neutral-400">
          Playback stopped — tap reload
        </span>
      )}

      {isReady && (
        <button
          type="button"
          onClick={handleOpenFullScreen}
          className="absolute inset-0 z-[5] cursor-pointer"
          aria-label={`Open full screen: ${data.relativePath}`}
        />
      )}

      {isReady && isLargeFile && (
        <span className="pointer-events-none absolute right-12 top-3.5 z-[6] rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-neutral-200">
          Tap for full
        </span>
      )}

      <CellPathLabel file={data} />
    </div>
  )
})
