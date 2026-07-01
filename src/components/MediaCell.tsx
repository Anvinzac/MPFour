import { memo, useEffect, useRef, useState } from 'react'
import type { RenderComponentProps } from 'masonic'
import { useCellHeight } from '../hooks/useCellHeight'
import { useFullScreen } from '../hooks/useFullScreen'
import { useGalleryFallback } from '../hooks/useGalleryFallback'
import { LARGE_VIDEO_BYTES } from '../lib/constants'
import {
  CanvasGridPlayer,
  canStartCanvasPlayer,
} from '../lib/mediabunnyPlayer'
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
  const failedRef = useRef(false)
  const { openFullScreen } = useFullScreen()
  const { reportSlotFailed } = useGalleryFallback()
  const [isReady, setIsReady] = useState(false)
  const [isLargeFile, setIsLargeFile] = useState(false)

  const height = useCellHeight(width, data.id, aspectRatio, useFixedHeight)

  useEffect(() => {
    failedRef.current = false
  }, [slotKey, data.id])

  useEffect(() => {
    const el = cellRef.current
    if (!el) return

    let cancelled = false
    let loadId = 0
    let playObserver: IntersectionObserver | null = null

    const failSlot = () => {
      if (failedRef.current || cancelled) return
      failedRef.current = true
      reportSlotFailed(slotKey)
    }

    const stopPlayback = () => {
      loadId++
      setIsReady(false)
      setIsLargeFile(false)
      playerRef.current?.dispose()
      playerRef.current = null
      canvasRef.current?.remove()
      canvasRef.current = null
    }

    const startPlayback = async () => {
      if (!canStartCanvasPlayer()) return

      const currentLoad = ++loadId
      setIsReady(false)

      try {
        const file = await data.handle.getFile()
        if (cancelled || currentLoad !== loadId || !cellRef.current) return

        setIsLargeFile(file.size > LARGE_VIDEO_BYTES)

        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width))
        canvas.height = Math.max(1, Math.round(height))
        canvas.className = 'media-cell__canvas h-full w-full'
        cellRef.current.appendChild(canvas)
        canvasRef.current = canvas

        const player = new CanvasGridPlayer()
        playerRef.current = player

        await player.mount(file, canvas, width, height)
        if (cancelled || currentLoad !== loadId) return

        await player.showFirstFrame()
        if (cancelled || currentLoad !== loadId) return

        player.play()
        canvas.classList.add('media-cell__canvas--ready')
        setIsReady(true)
      } catch {
        if (!cancelled) failSlot()
      }
    }

    playObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        void startPlayback()
      } else {
        stopPlayback()
      }
    }, PEEK_PLAYBACK_IO)

    playObserver.observe(el)

    return () => {
      cancelled = true
      playObserver?.disconnect()
      stopPlayback()
    }
  }, [data.id, data.handle, width, height, slotKey, reportSlotFailed])

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
