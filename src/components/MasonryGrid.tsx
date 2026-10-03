import { useCallback, useEffect, useRef } from 'react'
import { Masonry } from 'masonic'
import { GalleryFallbackProvider } from '../hooks/useGalleryFallback'
import { useGalleryRenderer } from '../hooks/useGalleryRenderer'
import { aspectRatioProbe } from '../lib/aspectRatioProbe'
import { NEAR_END_MARGIN_PX, SCAFFOLD_LOAD_AHEAD } from '../lib/constants'
import { mediaPreloader } from '../lib/mediaPreloader'
import { COLUMN_WIDTH, DEFAULT_ASPECT_RATIO, type GallerySlot, type MediaKind } from '../types'

interface MasonryGridProps {
  slots: GallerySlot[]
  onSlotFailed: (slotKey: string, kind: MediaKind) => void
  /** Called when the user scrolls near the end — load the next scaffold batch. */
  onNearEnd?: () => void
  /** Shown under the grid, e.g. while the scan is still finding folders. */
  footerStatus?: string | null
}

/**
 * Requests more whenever the bottom of the grid is within NEAR_END_MARGIN_PX
 * of the viewport — including after an append that still leaves it in view,
 * which masonic's onRender alone does not report.
 */
function useBottomSentinel(itemCount: number, onNearEnd?: () => void) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onNearEndRef = useRef(onNearEnd)
  onNearEndRef.current = onNearEnd

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onNearEndRef.current?.()
      },
      { rootMargin: `0px 0px ${NEAR_END_MARGIN_PX}px 0px` },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || itemCount === 0) return
    const frame = requestAnimationFrame(() => {
      if (node.getBoundingClientRect().top < window.innerHeight + NEAR_END_MARGIN_PX) {
        onNearEndRef.current?.()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [itemCount])

  return sentinelRef
}

const STABLE_HEIGHT_ESTIMATE = COLUMN_WIDTH / DEFAULT_ASPECT_RATIO

function isAppendOf(prev: GallerySlot[], next: GallerySlot[]): boolean {
  if (next.length < prev.length) return false
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].key !== next[i].key) return false
  }
  return true
}

/**
 * masonic caches item positions by index and never shrinks that cache, so
 * replacing the list with a shorter or reordered one (e.g. opening a folder)
 * makes it read past the end of `items`. Remount the grid whenever the list
 * is anything other than an in-place update or an append.
 */
function useLayoutGeneration(slots: GallerySlot[]): number {
  const prevRef = useRef(slots)
  const generationRef = useRef(0)
  if (prevRef.current !== slots) {
    if (!isAppendOf(prevRef.current, slots)) generationRef.current++
    prevRef.current = slots
  }
  return generationRef.current
}

export function MasonryGrid({
  slots,
  onSlotFailed,
  onNearEnd,
  footerStatus,
}: MasonryGridProps) {
  const render = useGalleryRenderer()
  const nearEndTimerRef = useRef(0)
  const layoutGeneration = useLayoutGeneration(slots)
  const sentinelRef = useBottomSentinel(slots.length, onNearEnd)

  const handleRender = useCallback(
    (startIndex: number, stopIndex: number) => {
      const mediaItems = slots.map((slot) => slot.media)
      mediaPreloader.syncWindow(mediaItems, startIndex, stopIndex)
      const preloadSlice = mediaPreloader.getPreloadRange(
        mediaItems,
        startIndex,
        stopIndex,
      )
      aspectRatioProbe.enqueueMany(
        preloadSlice
          .filter((item) => {
            const slot = slots.find((s) => s.media.id === item.id)
            return !slot?.useFixedHeight
          })
          .map((item) => ({
            id: item.id,
            handle: item.handle,
            kind: item.kind,
          })),
      )

      if (
        onNearEnd &&
        slots.length > 0 &&
        stopIndex >= slots.length - SCAFFOLD_LOAD_AHEAD
      ) {
        window.clearTimeout(nearEndTimerRef.current)
        nearEndTimerRef.current = window.setTimeout(() => {
          nearEndTimerRef.current = 0
          onNearEnd()
        }, 200)
      }
    },
    [slots, onNearEnd],
  )

  return (
    <GalleryFallbackProvider onSlotFailed={onSlotFailed}>
      <main className="gallery-grid px-2 pb-8 pt-2">
        <Masonry
          key={layoutGeneration}
          items={slots}
          columnWidth={COLUMN_WIDTH}
          columnGutter={8}
          rowGutter={8}
          overscanBy={1}
          itemKey={(slot, index) => slot?.key ?? `missing-${index}`}
          itemHeightEstimate={STABLE_HEIGHT_ESTIMATE}
          render={render}
          onRender={handleRender}
        />
        <div ref={sentinelRef} aria-hidden className="h-px w-full" />
        {footerStatus && (
          <p className="flex items-center justify-center gap-2 py-6 text-xs text-neutral-500">
            <span className="h-3 w-3 animate-spin rounded-full border border-neutral-600 border-t-neutral-300" />
            {footerStatus}
          </p>
        )}
      </main>
    </GalleryFallbackProvider>
  )
}
