import { useMemo, useSyncExternalStore } from 'react'
import type { RenderComponentProps } from 'masonic'
import { aspectRatioProbe } from '../lib/aspectRatioProbe'
import { BrokenCell } from '../components/BrokenCell'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { GalleryCell } from '../components/GalleryCell'
import { useGalleryFallback } from './useGalleryFallback'
import { DEFAULT_ASPECT_RATIO, type GallerySlot } from '../types'

function subscribeRatios(onChange: () => void) {
  return aspectRatioProbe.subscribe(onChange)
}

/**
 * Stable masonic render function — identity never changes, so cells are not
 * remounted when aspect ratios stream in.
 */
export function useGalleryRenderer() {
  useSyncExternalStore(
    subscribeRatios,
    () => aspectRatioProbe.version,
    () => 0,
  )

  return useMemo(() => {
    function RenderGalleryCell(props: RenderComponentProps<GallerySlot>) {
      const { media, key: slotKey, useFixedHeight } = props.data
      const aspectRatio = useFixedHeight
        ? DEFAULT_ASPECT_RATIO
        : aspectRatioProbe.get(media.id)
      const { reportSlotFailed } = useGalleryFallback()
      const height = props.width / aspectRatio
      // Keying by slotKey+mediaId remounts the boundary (clearing any prior
      // crash) whenever a failed slot is swapped for replacement media.
      const cellKey = `${slotKey}:${media.id}`

      return (
        <ErrorBoundary
          key={cellKey}
          fallback={<BrokenCell data={media} width={props.width} height={height} />}
          onError={() => reportSlotFailed(slotKey)}
        >
          <GalleryCell
            {...props}
            data={media}
            slotKey={slotKey}
            useFixedHeight={useFixedHeight}
            aspectRatio={aspectRatio}
          />
        </ErrorBoundary>
      )
    }
    return RenderGalleryCell
  }, [])
}
