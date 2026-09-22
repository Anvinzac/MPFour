import type { MediaStats } from '../types'

interface HeaderProps {
  onAddFolder: () => void
  onBrowse: () => void
  onRefresh: () => void
  onOpenHistory: () => void
  onClearAll?: () => void
  onOpenLegacy?: () => void
  legacyCount?: number
  playingCount: number
  mediaStats: MediaStats
  isScanning: boolean
  isDiscovering?: boolean
  hasMedia: boolean
}

function formatStats(stats: MediaStats, playingCount: number): string {
  const parts: string[] = []

  if (playingCount > 0) {
    parts.push(`${playingCount} playing`)
  }

  if (stats.images > 0) {
    parts.push(`${stats.images} photo${stats.images === 1 ? '' : 's'}`)
  }

  if (stats.videos > 0) {
    parts.push(`${stats.videos} video${stats.videos === 1 ? '' : 's'}`)
  }

  if (parts.length === 0) return '0 items'
  return parts.join(' · ')
}

export function Header({
  onAddFolder,
  onBrowse,
  onRefresh,
  onClearAll,
  onOpenHistory,
  onOpenLegacy,
  legacyCount = 0,
  playingCount,
  mediaStats,
  isScanning,
  isDiscovering = false,
  hasMedia,
}: HeaderProps) {
  return (
    <header className="border-b border-neutral-800 bg-neutral-950/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-lg font-semibold tracking-tight">
            MPFour
          </h1>
          {mediaStats.total > 0 && (
            <span className="shrink-0 rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-300">
              {formatStats(mediaStats, playingCount)}
            </span>
          )}
          {mediaStats.images > 0 && mediaStats.videos > 0 && (
            <span className="hidden text-xs text-neutral-500 sm:inline">
              Mixed gallery
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isScanning && (
            <span className="text-xs text-neutral-400">Scanning…</span>
          )}
          {!isScanning && isDiscovering && (
            <span className="text-xs text-neutral-500">Discovering more…</span>
          )}
          <button
            type="button"
            onClick={onOpenHistory}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-100 transition hover:border-neutral-500 hover:bg-neutral-900"
          >
            History
          </button>
          {legacyCount > 0 && onOpenLegacy && (
            <button
              type="button"
              onClick={onOpenLegacy}
              className="rounded-lg border border-violet-800/60 bg-violet-950/40 px-3 py-2 text-sm font-medium text-violet-200 transition hover:border-violet-600 hover:bg-violet-950/70"
            >
              Legacy ({legacyCount})
            </button>
          )}
          <button
            type="button"
            onClick={onAddFolder}
            disabled={isScanning}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Folder
          </button>
          <button
            type="button"
            onClick={onBrowse}
            disabled={isScanning}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-100 transition hover:border-neutral-500 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            title="Pick a root folder, then drill into subfolders"
          >
            Browse…
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!hasMedia || isScanning}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-100 transition hover:border-neutral-500 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
          {onClearAll && hasMedia && (
            <button
              type="button"
              onClick={onClearAll}
              disabled={isScanning}
              className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-300 transition hover:border-red-600 hover:bg-red-950/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear All
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
