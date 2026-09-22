import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchFavorites, removeFavorite, saveFavorite } from '../lib/favoritesApi'
import type { FavoriteRecord, MediaFile } from '../types'

interface FavoritesContextValue {
  favoriteIds: Set<string>
  isFavorite: (mediaId: string) => boolean
  toggleFavorite: (file: MediaFile, rootFolderName: string) => Promise<void>
  isLoading: boolean
  error: string | null
  clearError: () => void
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<FavoriteRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchFavorites()
        if (!cancelled) setRecords(data)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Favorites unavailable')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const favoriteIds = useMemo(
    () => new Set(records.map((record) => record.media_id)),
    [records],
  )

  const clearError = useCallback(() => setError(null), [])

  const isFavorite = useCallback(
    (mediaId: string) => favoriteIds.has(mediaId),
    [favoriteIds],
  )

  const toggleFavorite = useCallback(
    async (file: MediaFile, rootFolderName: string) => {
      setError(null)
      const wasFavorite = favoriteIds.has(file.id)

      if (wasFavorite) {
        setRecords((prev) => prev.filter((record) => record.media_id !== file.id))
        try {
          await removeFavorite(file.id)
        } catch (err) {
          setRecords((prev) => [
            ...prev,
            {
              media_id: file.id,
              folder_id: file.folderId,
              relative_path: file.relativePath,
              name: file.name,
              kind: file.kind,
              root_folder_name: rootFolderName,
              created_at: Date.now(),
            },
          ])
          setError(err instanceof Error ? err.message : 'Failed to remove favorite')
        }
        return
      }

      const optimistic: FavoriteRecord = {
        media_id: file.id,
        folder_id: file.folderId,
        relative_path: file.relativePath,
        name: file.name,
        kind: file.kind,
        root_folder_name: rootFolderName,
        created_at: Date.now(),
      }
      setRecords((prev) => [optimistic, ...prev])

      try {
        const saved = await saveFavorite(file, rootFolderName)
        setRecords((prev) => [
          saved,
          ...prev.filter((record) => record.media_id !== file.id),
        ])
      } catch (err) {
        setRecords((prev) => prev.filter((record) => record.media_id !== file.id))
        setError(err instanceof Error ? err.message : 'Failed to save favorite')
      }
    },
    [favoriteIds],
  )

  const value = useMemo(
    () => ({
      favoriteIds,
      isFavorite,
      toggleFavorite,
      isLoading,
      error,
      clearError,
    }),
    [favoriteIds, isFavorite, toggleFavorite, isLoading, error, clearError],
  )

  return (
    <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (!ctx) {
    throw new Error('useFavorites must be used within FavoritesProvider')
  }
  return ctx
}
