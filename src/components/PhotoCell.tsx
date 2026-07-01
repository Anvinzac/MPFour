import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { RenderComponentProps } from 'masonic'
import { useCellHeight } from '../hooks/useCellHeight'
import { useFullScreen } from '../hooks/useFullScreen'
import { useGalleryFallback } from '../hooks/useGalleryFallback'
import { mediaPreloader } from '../lib/mediaPreloader'
import { PEEK_PLAYBACK_IO, PEEK_PREPARE_IO } from '../lib/mediaReady'
import { CellPathLabel } from './CellPathLabel'
import { FavoriteButton } from './FavoriteButton'
import type { MediaFile } from '../types'

interface PhotoCellProps extends RenderComponentProps<MediaFile> {
  slotKey: string
  useFixedHeight: boolean
  aspectRatio: number
}

export const PhotoCell = memo(function PhotoCell({
  data,
  width,
  slotKey,
  useFixedHeight,
  aspectRatio,
}: PhotoCellProps) {
  const cellRef = useRef<HTMLDivElement>(null)
  const failedRef = useRef(false)
  const reportFailedRef = useRef<(key: string) => void>(() => {})
  const [src, setSrc] = useState<string | null>(() =>
    mediaPreloader.isReady(data.id) ? mediaPreloader.get(data.id) : null,
  )
  const [isReady, setIsReady] = useState(() => mediaPreloader.isReady(data.id))
  const { openFullScreen } = useFullScreen()
  const { reportSlotFailed } = useGalleryFallback()
  reportFailedRef.current = reportSlotFailed

  const height = useCellHeight(width, data.id, aspectRatio, useFixedHeight)

  const failSlot = useCallback(() => {
    if (failedRef.current) return
    failedRef.current = true
    reportFailedRef.current(slotKey)
  }, [slotKey])

  useEffect(() => {
    failedRef.current = false
  }, [slotKey, data.id])

  useEffect(() => {
    const el = cellRef.current
    if (!el) return

    let cancelled = false
    let loadId = 0

    const fail = () => {
      if (failedRef.current || cancelled) return
      failSlot()
    }

    const showWhenReady = async () => {
      const currentLoad = ++loadId

      if (mediaPreloader.isReady(data.id)) {
        const cached = mediaPreloader.get(data.id)
        if (cached) {
          setSrc(cached)
          setIsReady(true)
          return
        }
      }

      setIsReady(false)

      const url = await mediaPreloader.prepare(data.id, data.handle, data.kind)
      if (cancelled || currentLoad !== loadId) return
      if (!url) {
        fail()
        return
      }

      setSrc(url)
      setIsReady(true)
    }

    const prepareObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        void mediaPreloader.prepare(data.id, data.handle, data.kind)
      }
    }, PEEK_PREPARE_IO)

    const displayObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        void showWhenReady()
      }
    }, PEEK_PLAYBACK_IO)

    prepareObserver.observe(el)
    displayObserver.observe(el)

    return () => {
      cancelled = true
      prepareObserver.disconnect()
      displayObserver.disconnect()
    }
  }, [data.id, data.handle, data.kind, failSlot])

  const handleImgError = () => {
    void mediaPreloader
      .prepare(data.id, data.handle, data.kind)
      .then((url) => {
        if (url) {
          setSrc(url)
          setIsReady(true)
        }
      })
      .catch(() => failSlot())
  }

  return (
    <div
      ref={cellRef}
      className="gallery-cell photo-cell relative overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/5"
      style={{ width, height, contain: 'layout style paint' }}
      title={data.relativePath}
    >
      <FavoriteButton file={data} />

      {isReady && (
        <button
          type="button"
          onClick={() => openFullScreen(data)}
          className="absolute inset-0 z-[5] cursor-pointer"
          aria-label={`Open full screen: ${data.relativePath}`}
        />
      )}
      {src && (
        <img
          src={src}
          alt={data.name}
          decoding="async"
          onError={handleImgError}
          className={`photo-cell__img h-full w-full object-cover ${
            isReady ? 'photo-cell__img--visible' : ''
          }`}
        />
      )}

      <CellPathLabel file={data} />
    </div>
  )
})
