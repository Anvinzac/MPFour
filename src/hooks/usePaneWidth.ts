import { useCallback, useState } from 'react'

const STORAGE_KEY = 'mpfour:playerPaneWidth'
export const DEFAULT_PANE_WIDTH = 30
export const MIN_PANE_WIDTH = 15
export const MAX_PANE_WIDTH = 70

function clampWidth(percent: number): number {
  return Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, percent))
}

function readStoredWidth(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return stored > 0 ? clampWidth(stored) : DEFAULT_PANE_WIDTH
  } catch {
    return DEFAULT_PANE_WIDTH
  }
}

/** Player pane width as a percentage of the window, remembered per browser. */
export function usePaneWidth(): [number, (percent: number) => void] {
  const [width, setWidthState] = useState(readStoredWidth)

  const setWidth = useCallback((percent: number) => {
    const next = Math.round(clampWidth(percent) * 10) / 10
    setWidthState(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // storage unavailable (private mode); width lasts for this page only
    }
  }, [])

  return [width, setWidth]
}
