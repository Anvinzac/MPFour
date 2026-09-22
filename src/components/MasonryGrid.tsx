import { useCallback, useRef } from 'react'
import { Masonry } from 'masonic'
import { GalleryFallbackProvider } from '../hooks/useGalleryFallback'
import { useGalleryRenderer } from '../hooks/useGalleryRenderer'
import { aspectRatioProbe } from '../lib/aspectRatioProbe'
import { SCAFFOLD_LOAD_AHEAD } from '../lib/constants'
import { mediaPreloader } from '../lib/mediaPreloader'
import { COLUMN_WIDTH, DEFAULT_ASPECT_RATIO, type GallerySlot, type MediaKind } from '../types'

interface MasonryGridProps {
  slots: GallerySlot[]
  onSlotFailed: (slotKey: string, kind: MediaKind) => void
  /** Called when the user scrolls near the end — load the next scaffold batch. */
  onNearEnd?: () => void
}

const STABLE_HEIGHT_ESTIMATE = COLUMN_WIDTH / DEFAULT_ASPECT_RATIO

export function MasonryGrid({ slots, onSlotFailed, onNearEnd }: MasonryGridProps) {
  const render = useGalleryRenderer()
  const nearEndTimerRef = useRef(0)

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
          items={slots}
          columnWidth={COLUMN_WIDTH}
          columnGutter={8}
          rowGutter={8}
          overscanBy={1}
          itemKey={(slot) => slot.key}
          itemHeightEstimate={STABLE_HEIGHT_ESTIMATE}
          render={render}
          onRender={handleRender}
        />
      </main>
    </GalleryFallbackProvider>
  )
}
