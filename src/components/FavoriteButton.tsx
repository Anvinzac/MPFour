import { useFavorites } from '../hooks/useFavorites'
import { useRootFolderName } from '../hooks/useGalleryActions'
import type { MediaFile } from '../types'

interface FavoriteButtonProps {
  file: MediaFile
}

export function FavoriteButton({ file }: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useFavorites()
  const rootFolderName = useRootFolderName()
  const active = isFavorite(file.id)

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        void toggleFavorite(file, rootFolderName(file.folderId))
      }}
      className={`absolute left-2 top-2 z-[12] flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition ${
        active
          ? 'bg-amber-500/90 text-neutral-950'
          : 'bg-black/50 text-neutral-200 hover:bg-black/70'
      }`}
      aria-label={active ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={active}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M12 17.3 6.2 21l1.6-6.9L2 9.3l7-.6L12 2l3 6.7 7 .6-5.8 4.8 1.6 6.9z" />
      </svg>
    </button>
  )
}
