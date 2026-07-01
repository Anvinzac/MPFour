import { useCallback } from 'react'
import { Masonry } from 'masonic'
import { GalleryFallbackProvider } from '../hooks/useGalleryFallback'
import { useGalleryRenderer } from '../hooks/useGalleryRenderer'
import { aspectRatioProbe } from '../lib/aspectRatioProbe'
import { mediaPreloader } from '../lib/mediaPreloader'
import { COLUMN_WIDTH, DEFAULT_ASPECT_RATIO, type GallerySlot } from '../types'

interface MasonryGridProps {
  slots: GallerySlot[]
  onSlotFailed: (slotKey: string) => void
}

const STABLE_HEIGHT_ESTIMATE = COLUMN_WIDTH / DEFAULT_ASPECT_RATIO

export function MasonryGrid({ slots, onSlotFailed }: MasonryGridProps) {
  const render = useGalleryRenderer()

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
    },
    [slots],
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
