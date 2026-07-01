import type { GalleryView } from '../types'

interface GalleryFilterBarProps {
  galleryView: GalleryView
  onShowMixed: () => void
  onShowFavorites: () => void
  favoriteCount: number
}

export function GalleryFilterBar({
  galleryView,
  onShowMixed,
  onShowFavorites,
  favoriteCount,
}: GalleryFilterBarProps) {
  const isMixed = galleryView.mode === 'mixed'
  const isFavorites = galleryView.mode === 'favorites'
  const isSubfolder = galleryView.mode === 'subfolder'

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onShowMixed}
        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
          isMixed
            ? 'bg-white text-neutral-900'
            : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
        }`}
      >
        All mixed
      </button>
      <button
        type="button"
        onClick={onShowFavorites}
        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
          isFavorites
            ? 'bg-amber-500 text-neutral-950'
            : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
        }`}
      >
        Favorites{favoriteCount > 0 ? ` (${favoriteCount})` : ''}
      </button>

      {isSubfolder && (
        <div className="flex min-w-0 items-center gap-2 rounded-full bg-sky-950/60 px-3 py-1 text-xs text-sky-200 ring-1 ring-sky-800/60">
          <span className="truncate">Folder: {galleryView.filter.label}</span>
          <button
            type="button"
            onClick={onShowMixed}
            className="shrink-0 text-sky-300 hover:text-white"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
