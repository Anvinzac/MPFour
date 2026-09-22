import { createContext, useContext, type ReactNode } from 'react'
import type { MediaKind } from '../types'

interface GalleryFallbackContextValue {
  reportSlotFailed: (slotKey: string, kind: MediaKind) => void
}

const GalleryFallbackContext = createContext<GalleryFallbackContextValue | null>(
  null,
)

export function GalleryFallbackProvider({
  onSlotFailed,
  children,
}: {
  onSlotFailed: (slotKey: string, kind: MediaKind) => void
  children: ReactNode
}) {
  return (
    <GalleryFallbackContext.Provider value={{ reportSlotFailed: onSlotFailed }}>
      {children}
    </GalleryFallbackContext.Provider>
  )
}

export function useGalleryFallback(): GalleryFallbackContextValue {
  const ctx = useContext(GalleryFallbackContext)
  if (!ctx) {
    throw new Error('useGalleryFallback must be used within GalleryFallbackProvider')
  }
  return ctx
}
