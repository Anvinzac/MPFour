import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isFileWithinLimit } from '../lib/fileScanner'
import { FullScreenVideo } from '../components/FullScreenVideo'
import type { MediaFile } from '../types'

interface FullScreenContextValue {
  openFullScreen: (file: MediaFile) => void
  closeFullScreen: () => void
}

const FullScreenContext = createContext<FullScreenContextValue | null>(null)

export function FullScreenProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<MediaFile | null>(null)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const closeFullScreen = useCallback(() => {
    setFile(null)
    setMediaFile(null)
    setImageUrl(null)
    setError(null)
    setLoading(false)
  }, [])

  const openFullScreen = useCallback((media: MediaFile) => {
    setFile(media)
    setError(null)
    setLoading(true)
  }, [])

  useEffect(() => {
    if (!file) return

    let cancelled = false

    setLoading(true)
    setError(null)
    setMediaFile(null)
    setImageUrl(null)

    void file.handle
      .getFile()
      .then((loaded) => {
        if (cancelled) return
        if (!isFileWithinLimit(loaded.size)) {
          setError('This file exceeds the 100 MB limit')
          setLoading(false)
          return
        }
        setMediaFile(loaded)
        if (file.kind === 'image') {
          setImageUrl(URL.createObjectURL(loaded))
        }
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load full file')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      setMediaFile(null)
      setImageUrl((url) => {
        if (url) URL.revokeObjectURL(url)
        return null
      })
    }
  }, [file])

  useEffect(() => {
    if (!file) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFullScreen()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [file, closeFullScreen])

  const value = useMemo(
    () => ({ openFullScreen, closeFullScreen }),
    [openFullScreen, closeFullScreen],
  )

  return (
    <FullScreenContext.Provider value={value}>
      {children}
      {file && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/95"
          role="dialog"
          aria-modal="true"
          aria-label={file.relativePath}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <p className="min-w-0 truncate text-sm text-neutral-200">
              {file.relativePath}
            </p>
            <button
              type="button"
              onClick={closeFullScreen}
              className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {loading && (
              <p className="text-sm text-neutral-400">Loading full file…</p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {!loading && !error && mediaFile && file.kind === 'video' && (
              <FullScreenVideo file={mediaFile} />
            )}
            {!loading && !error && imageUrl && file.kind === 'image' && (
              <img
                src={imageUrl}
                alt={file.name}
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        </div>
      )}
    </FullScreenContext.Provider>
  )
}

export function useFullScreen(): FullScreenContextValue {
  const ctx = useContext(FullScreenContext)
  if (!ctx) {
    throw new Error('useFullScreen must be used within FullScreenProvider')
  }
  return ctx
}
