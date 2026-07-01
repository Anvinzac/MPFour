import { createContext, useContext, type ReactNode } from 'react'
import type { GalleryView, MediaFile } from '../types'

interface GalleryActionsContextValue {
  galleryView: GalleryView
  filterToSubfolder: (file: MediaFile) => void
  showMixedGallery: () => void
  showFavoritesGallery: () => void
  rootFolderName: (folderId: string) => string
}

const GalleryActionsContext = createContext<GalleryActionsContextValue | null>(
  null,
)

export function GalleryActionsProvider({
  value,
  children,
}: {
  value: GalleryActionsContextValue
  children: ReactNode
}) {
  return (
    <GalleryActionsContext.Provider value={value}>
      {children}
    </GalleryActionsContext.Provider>
  )
}

export function useGalleryActions(): GalleryActionsContextValue {
  const ctx = useContext(GalleryActionsContext)
  if (!ctx) {
    throw new Error('useGalleryActions must be used within GalleryActionsProvider')
  }
  return ctx
}

export function useFilterToSubfolder() {
  const { filterToSubfolder } = useGalleryActions()
  return filterToSubfolder
}

export function useRootFolderName() {
  const { rootFolderName } = useGalleryActions()
  return rootFolderName
}
