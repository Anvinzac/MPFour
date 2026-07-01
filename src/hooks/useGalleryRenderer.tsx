import { useMemo, useSyncExternalStore } from 'react'
import type { RenderComponentProps } from 'masonic'
import { aspectRatioProbe } from '../lib/aspectRatioProbe'
import { GalleryCell } from '../components/GalleryCell'
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

      return (
        <GalleryCell
          {...props}
          data={media}
          slotKey={slotKey}
          useFixedHeight={useFixedHeight}
          aspectRatio={aspectRatio}
        />
      )
    }
    return RenderGalleryCell
  }, [])
}
