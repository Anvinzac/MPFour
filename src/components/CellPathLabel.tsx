import { useFilterToSubfolder } from '../hooks/useGalleryActions'
import type { MediaFile } from '../types'

interface CellPathLabelProps {
  file: MediaFile
  visible?: boolean
}

export function CellPathLabel({ file, visible = true }: CellPathLabelProps) {
  const filterToSubfolder = useFilterToSubfolder()

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 to-transparent px-2.5 py-2 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          filterToSubfolder(file)
        }}
        className="pointer-events-auto truncate text-left text-xs text-neutral-200 underline decoration-neutral-500/60 underline-offset-2 transition hover:text-white hover:decoration-neutral-300"
        title={`Show only files in ${file.relativePath.includes('/') ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/')) : 'this folder'}`}
      >
        {file.relativePath}
      </button>
    </div>
  )
}
