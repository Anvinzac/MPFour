import { useEffect, useState } from 'react'

export interface MemoryStats {
  /** Used JS heap in bytes, or null when the browser doesn't expose it. */
  usedJSHeapSize: number | null
  /** Total allocated JS heap in bytes, or null when unavailable. */
  totalJSHeapSize: number | null
  /** Hard cap on the JS heap in bytes, or null when unavailable. */
  jsHeapSizeLimit: number | null
}

/**
 * Polls `performance.memory` (Chrome / Edge / Opera only) and returns the
 * latest sample. Polls every `intervalMs` milliseconds, defaulting to 2s —
 * frequent enough to react to scroll bursts, light enough to not move the
 * needle on heap pressure itself.
 */
export function useMemoryStats(intervalMs = 2000): MemoryStats {
  const [stats, setStats] = useState<MemoryStats>(() => readMemory())

  useEffect(() => {
    const id = window.setInterval(() => {
      setStats(readMemory())
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return stats
}

function readMemory(): MemoryStats {
  const perfMem = (performance as unknown as {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }).memory

  if (!perfMem) {
    return { usedJSHeapSize: null, totalJSHeapSize: null, jsHeapSizeLimit: null }
  }

  return {
    usedJSHeapSize: perfMem.usedJSHeapSize,
    totalJSHeapSize: perfMem.totalJSHeapSize,
    jsHeapSizeLimit: perfMem.jsHeapSizeLimit,
  }
}
