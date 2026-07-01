import { useRef } from 'react'
import { aspectRatioProbe } from '../lib/aspectRatioProbe'
import { DEFAULT_ASPECT_RATIO } from '../types'

interface HeightEntry {
  id: string
  height: number
  locked: boolean
}

/**
 * Locks cell height after the first real aspect-ratio probe so masonry
 * doesn't keep reflowing while media loads.
 */
export function useCellHeight(
  width: number,
  itemId: string,
  aspectRatio: number,
  useFixedHeight = false,
): number {
  if (useFixedHeight) {
    return width / DEFAULT_ASPECT_RATIO
  }
  const entry = useRef<HeightEntry>({
    id: itemId,
    height: width / DEFAULT_ASPECT_RATIO,
    locked: false,
  })

  if (entry.current.id !== itemId) {
    entry.current = {
      id: itemId,
      height: width / DEFAULT_ASPECT_RATIO,
      locked: false,
    }
  }

  if (!entry.current.locked && aspectRatioProbe.has(itemId)) {
    entry.current.height = width / aspectRatio
    entry.current.locked = true
  }

  return entry.current.height
}
