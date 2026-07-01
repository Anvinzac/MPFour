import { memo, useEffect, useRef, useState } from 'react'
import type { RenderComponentProps } from 'masonic'
import { useCellHeight } from '../hooks/useCellHeight'
import { useFullScreen } from '../hooks/useFullScreen'
import { useGalleryFallback } from '../hooks/useGalleryFallback'
import { LARGE_VIDEO_BYTES } from '../lib/constants'
import { CanvasGridPlayer } from '../lib/mediabunnyPlayer'
import { PEEK_PLAYBACK_IO } from '../lib/mediaReady'
import { CellPathLabel } from './CellPathLabel'
import { FavoriteButton } from './FavoriteButton'
import type { MediaFile } from '../types'

interface MediaCellProps extends RenderComponentProps<MediaFile> {
  slotKey: string
  useFixedHeight: boolean
  aspectRatio: number
}

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
  const { openFullScreen } = useFullScreen()
  const { reportSlotFailed } = useGalleryFallback()
  const [isReady, setIsReady] = useState(false)
  const [isLargeFile, setIsLargeFile] = useState(false)

  const height = useCellHeight(width, data.id, aspectRatio, useFixedHeight)
  sizeRef.current = { width, height }

  const reportFailedRef = useRef(reportSlotFailed)
  reportFailedRef.current = reportSlotFailed

  useEffect(() => {
    const el = cellRef.current
    if (!el) return

    let cancelled = false
    let loadId = 0
    let playObserver: IntersectionObserver | null = null
    let stopTimer = 0

    const failSlot = () => {
      if (failedRef.current || cancelled) return
      failedRef.current = true
      reportFailedRef.current(slotKey)
    }

    const releasePlayer = () => {
      playerRef.current?.dispose()
      playerRef.current = null
    }

    const teardownPlayback = () => {
      loadId++
      if (stopTimer) {
        window.clearTimeout(stopTimer)
        stopTimer = 0
      }
      setIsReady(false)
      setIsLargeFile(false)
      releasePlayer()
      canvasRef.current?.remove()
      canvasRef.current = null
    }

    const abortLoad = (player: CanvasGridPlayer | null) => {
      player?.dispose()
      if (playerRef.current === player) {
        playerRef.current = null
      }
    }

    const startPlayback = async () => {
      if (playerRef.current) {
        playerRef.current.play()
        return
      }

      const currentLoad = ++loadId
      let player: CanvasGridPlayer | null = null

      try {
        const file = await data.handle.getFile()
        if (cancelled || currentLoad !== loadId || !cellRef.current) return

        setIsLargeFile(file.size > LARGE_VIDEO_BYTES)

        const { width: cellW, height: cellH } = sizeRef.current
        let canvas = canvasRef.current
        if (!canvas) {
          canvas = document.createElement('canvas')
          canvas.className = 'media-cell__canvas h-full w-full'
          cellRef.current.appendChild(canvas)
          canvasRef.current = canvas
        }
        canvas.width = Math.max(1, Math.round(cellW))
        canvas.height = Math.max(1, Math.round(cellH))

        player = new CanvasGridPlayer()
        playerRef.current = player

        await player.mount(file, canvas, cellW, cellH)
        if (cancelled || currentLoad !== loadId) {
          abortLoad(player)
          return
        }

        await player.showFirstFrame()
        if (cancelled || currentLoad !== loadId) {
          abortLoad(player)
          return
        }

        player.play()
        canvas.classList.add('media-cell__canvas--ready')
        setIsReady(true)
      } catch {
        abortLoad(player)
        // A genuine decode/mount failure (unsupported codec, corrupt file,
        // etc.) — not a cancellation. Ask for a replacement so the slot
        // doesn't sit blank forever; the ErrorBoundary fallback tile covers
        // the (rare) case where none is available.
        if (!cancelled) failSlot()
      }
    }

    playObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (stopTimer) {
          window.clearTimeout(stopTimer)
          stopTimer = 0
        }
        void startPlayback()
      } else if (!stopTimer) {
        stopTimer = window.setTimeout(() => {
          stopTimer = 0
          playerRef.current?.stop()
        }, 800)
      }
    }, PEEK_PLAYBACK_IO)

    playObserver.observe(el)

    return () => {
      cancelled = true
      if (stopTimer) window.clearTimeout(stopTimer)
      playObserver?.disconnect()
      teardownPlayback()
    }
  }, [data.id, data.handle, slotKey])

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

      {isReady && (
        <button
          type="button"
          onClick={handleOpenFullScreen}
          className="absolute inset-0 z-[5] cursor-pointer"
          aria-label={`Open full screen: ${data.relativePath}`}
        />
      )}

      {isReady && isLargeFile && (
        <span className="pointer-events-none absolute right-2 top-2 z-[6] rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-neutral-200">
          Tap for full
        </span>
      )}

      <CellPathLabel file={data} />
    </div>
  )
})
