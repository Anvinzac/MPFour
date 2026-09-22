import { useEffect, useState } from 'react'
import { getActiveCanvasPlayerCount } from '../lib/mediabunnyPlayer'
import { mediaPreloader } from '../lib/mediaPreloader'
import { useMemoryStats } from '../hooks/useMemoryStats'

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Approximate color for the heap chip based on used/limit ratio. */
function heapTone(ratio: number | null): string {
  if (ratio === null) return 'bg-neutral-800 text-neutral-300'
  if (ratio < 0.5) return 'bg-emerald-950/80 text-emerald-200 border-emerald-900'
  if (ratio < 0.75) return 'bg-amber-950/80 text-amber-200 border-amber-900'
  return 'bg-red-950/80 text-red-200 border-red-900'
}

export function MemoryChip() {
  const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = useMemoryStats(2000)
  const [expanded, setExpanded] = useState(false)

  // Live counters that update on render — cheap reads.
  const [decodedPlayers, setDecodedPlayers] = useState(getActiveCanvasPlayerCount)
  const [preloadSize, setPreloadSize] = useState(mediaPreloader.size)
  const [preloadMax, setPreloadMax] = useState(mediaPreloader.maxSize)

  useEffect(() => {
    // Poll the canvas player count separately; the existing listener covers
    // the hook we already have, but this keeps the chip in sync even when
    // collapsed. 2s matches the heap poll cadence.
    const id = window.setInterval(() => {
      setDecodedPlayers(getActiveCanvasPlayerCount())
      setPreloadSize(mediaPreloader.size)
      setPreloadMax(mediaPreloader.maxSize)
    }, 2000)
    return () => window.clearInterval(id)
  }, [])

  const ratio =
    usedJSHeapSize !== null && jsHeapSizeLimit !== null && jsHeapSizeLimit > 0
      ? usedJSHeapSize / jsHeapSizeLimit
      : null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {expanded && (
        <div className="pointer-events-auto w-72 rounded-lg border border-neutral-800 bg-neutral-950/95 p-3 text-xs text-neutral-200 shadow-xl backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-neutral-100">Tab memory</span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-neutral-500 hover:text-neutral-200"
              aria-label="Collapse memory panel"
            >
              ×
            </button>
          </div>

          <dl className="space-y-1.5">
            <Row label="JS heap (used)">
              <span className="font-mono">{formatBytes(usedJSHeapSize)}</span>
            </Row>
            <Row label="JS heap (total)">
              <span className="font-mono">{formatBytes(totalJSHeapSize)}</span>
            </Row>
            <Row label="JS heap (limit)">
              <span className="font-mono">{formatBytes(jsHeapSizeLimit)}</span>
            </Row>
            <Row label="Decoded players">
              <span className="font-mono">{decodedPlayers}</span>
              <span className="ml-1 text-neutral-500">
                (canvas pool: tier 1, video: tier 2)
              </span>
            </Row>
            <Row label="Preloader cache">
              <span className="font-mono">
                {preloadSize} / {preloadMax}
              </span>
              <span className="ml-1 text-neutral-500">
                image + video blob URLs
              </span>
            </Row>
          </dl>

          {ratio === null ? (
            <p className="mt-2 text-[10px] text-neutral-500">
              Heap stats require Chrome / Edge / Opera. Try{' '}
              <code className="rounded bg-neutral-800 px-1">chrome://memory-internals</code>{' '}
              for the full picture.
            </p>
          ) : (
            <p className="mt-2 text-[10px] text-neutral-500">
              {Math.round(ratio * 100)}% of the per-tab heap limit in use. Watch
              this as you scroll — if it keeps climbing without plateauing, the
              active-cell window may be too large.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur-sm transition ${heapTone(ratio)}`}
        aria-label={
          expanded ? 'Collapse memory panel' : 'Expand memory panel'
        }
        title="Click for memory breakdown"
      >
        <span className="font-mono">{formatBytes(usedJSHeapSize)}</span>
        <span className="opacity-60">·</span>
        <span className="font-mono">{decodedPlayers} playing</span>
      </button>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}
