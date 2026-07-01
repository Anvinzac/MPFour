import { COLUMN_WIDTH, DEFAULT_ASPECT_RATIO } from '../types'

const COLUMN_GUTTER = 10
const ROW_GUTTER = 10
const HEADER_HEIGHT = 57
const HORIZONTAL_PADDING = 24

/** How many viewport-heights of items to preload beyond the visible range. */
export const PRELOAD_VIEWPORT_MULTIPLIER = 2

export function calculateItemsPerViewport(
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight - HEADER_HEIGHT,
  columnWidth = COLUMN_WIDTH,
): number {
  const usableWidth = Math.max(viewportWidth - HORIZONTAL_PADDING, columnWidth)
  const cols = Math.max(
    1,
    Math.floor((usableWidth + COLUMN_GUTTER) / (columnWidth + COLUMN_GUTTER)),
  )
  const avgCellHeight = columnWidth / DEFAULT_ASPECT_RATIO + ROW_GUTTER
  const rows = Math.max(1, Math.ceil(viewportHeight / avgCellHeight))
  return cols * rows
}

export function calculatePreloadPadding(
  viewportWidth?: number,
  viewportHeight?: number,
): number {
  return PRELOAD_VIEWPORT_MULTIPLIER * calculateItemsPerViewport(
    viewportWidth,
    viewportHeight,
  )
}

export function calculatePreloadIndexRange(
  startIndex: number,
  stopIndex: number,
  totalItems: number,
  viewportWidth?: number,
  viewportHeight?: number,
): { from: number; to: number; maxCache: number } {
  const padding = calculatePreloadPadding(viewportWidth, viewportHeight)
  const visibleCount = stopIndex - startIndex + 1
  const from = Math.max(0, startIndex - padding)
  const to = Math.min(totalItems - 1, stopIndex + padding)
  const maxCache = visibleCount + padding * 2

  return { from, to, maxCache }
}
