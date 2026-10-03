import { MasonryGrid } from './MasonryGrid'
import { useCanvasPlayerCount } from '../hooks/useCanvasPlayerCount'
import { GalleryActionsProvider } from '../hooks/useGalleryActions'
import type { GallerySlot, GalleryView, MediaFile, MediaKind } from '../types'

interface LegacyVideoPageProps {
  legacyItems: GallerySlot[]
  legacyCount: number
  isDiscovering: boolean
  isScanning: boolean
  onBack: () => void
  onRefresh: () => void
  reportSlotFailed: (slotKey: string, kind: MediaKind) => void
  onNearEnd?: () => void
  filterToSubfolder: (file: MediaFile) => void
  showMixedGallery: () => void
  showFavoritesGallery: () => void
  rootFolderName: (folderId: string) => string
  galleryView: GalleryView
}

export function LegacyVideoPage({
  legacyItems,
  legacyCount,
  isDiscovering,
  isScanning,
  onBack,
  onRefresh,
  reportSlotFailed,
  onNearEnd,
  filterToSubfolder,
  showMixedGallery,
  showFavoritesGallery,
  rootFolderName,
  galleryView,
}: LegacyVideoPageProps) {
  const playingCount = useCanvasPlayerCount()

  const galleryActions = {
    galleryView,
    filterToSubfolder,
    showMixedGallery,
    showFavoritesGallery,
    rootFolderName,
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <header className="sticky top-0 z-50 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
            >
              ← Gallery
            </button>
            <h1 className="truncate text-lg font-semibold">Legacy Videos</h1>
          </div>
          <span className="shrink-0 rounded-full bg-violet-900/50 px-2.5 py-0.5 text-xs text-violet-200">
            MKV · AVI · WMV
          </span>
        </div>
      </header>

      <GalleryActionsProvider value={galleryActions}>
        <div className="mx-auto max-w-7xl px-4 pb-8 pt-4">
          <div className="mb-4 rounded-lg border border-violet-900/40 bg-violet-950/30 px-4 py-3 text-sm text-violet-200">
            <p className="font-medium">Legacy container formats</p>
            <p className="mt-1 text-xs text-violet-300/90">
              MKV, AVI, and WMV use WebCodecs via Mediabunny when your browser
              supports the codec. Unsupported files show as failed slots.
              {playingCount > 0 ? ` ${playingCount} attempting playback.` : ''}
            </p>
          </div>

          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-400">
              {legacyCount} file{legacyCount === 1 ? '' : 's'}
              {isDiscovering ? ' · discovering more…' : ''}
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={legacyCount === 0 || isScanning}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
            >
              Reshuffle
            </button>
          </div>

          {legacyItems.length > 0 ? (
            <MasonryGrid
              slots={legacyItems}
              onSlotFailed={reportSlotFailed}
              onNearEnd={onNearEnd}
              footerStatus={isDiscovering ? 'Scanning more folders…' : null}
            />
          ) : isScanning || isDiscovering ? (
            <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
              Scanning for legacy videos…
            </div>
          ) : (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center text-sm text-neutral-500">
              <p>No MKV, AVI, or WMV files found in active folders.</p>
              <p className="text-xs text-neutral-600">
                Add a folder that contains these formats to see them here.
              </p>
            </div>
          )}
        </div>
      </GalleryActionsProvider>
    </div>
  )
}
