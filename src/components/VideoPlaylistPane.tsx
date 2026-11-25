import { useEffect, useRef, useState } from 'react'
import { useFilterToSubfolder } from '../hooks/useGalleryActions'
import { shuffle } from '../lib/shuffle'
import type { MediaFile } from '../types'

interface VideoPlaylistPaneProps {
  /** Every video in the current gallery view; grows as the scan finds more. */
  videos: MediaFile[]
  /** Changes when the gallery view changes, which restarts the playlist. */
  resetKey: string
  isDiscovering: boolean
}

interface Playlist {
  key: string
  items: MediaFile[]
  index: number
}

/**
 * Keeps the play order stable while the pool changes: new videos join the end
 * in random order, removed ones drop out, and the current video keeps playing.
 */
function reconcilePlaylist(
  prev: Playlist,
  videos: MediaFile[],
  resetKey: string,
): Playlist {
  if (prev.key !== resetKey) {
    return { key: resetKey, items: shuffle(videos), index: 0 }
  }

  const presentIds = new Set(videos.map((file) => file.id))
  const kept = prev.items.filter((file) => presentIds.has(file.id))
  const keptIds = new Set(kept.map((file) => file.id))
  const added = shuffle(videos.filter((file) => !keptIds.has(file.id)))
  if (added.length === 0 && kept.length === prev.items.length) return prev

  const items = [...kept, ...added]
  const current = prev.items[prev.index]
  let index = current ? items.findIndex((file) => file.id === current.id) : -1
  if (index < 0) index = Math.min(prev.index, Math.max(0, items.length - 1))
  return { key: resetKey, items, index }
}

export function VideoPlaylistPane({
  videos,
  resetKey,
  isDiscovering,
}: VideoPlaylistPaneProps) {
  const filterToSubfolder = useFilterToSubfolder()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playlist, setPlaylist] = useState<Playlist>(() => ({
    key: resetKey,
    items: shuffle(videos),
    index: 0,
  }))
  const [src, setSrc] = useState<string | null>(null)
  const srcRef = useRef<string | null>(null)
  // Consecutive files that failed to play; stops a lap of broken files from spinning forever.
  const [failStreak, setFailStreak] = useState(0)

  useEffect(() => {
    setPlaylist((prev) => reconcilePlaylist(prev, videos, resetKey))
  }, [videos, resetKey])

  useEffect(() => {
    setFailStreak(0)
  }, [resetKey])

  const total = playlist.items.length
  const current = total > 0 ? playlist.items[playlist.index] : null
  const currentRef = useRef(current)
  currentRef.current = current
  const currentId = current?.id ?? null
  const allFailed = total > 0 && failStreak >= total

  const step = (delta: number) => {
    setPlaylist((prev) => {
      if (prev.items.length === 0) return prev
      const index = (prev.index + delta + prev.items.length) % prev.items.length
      return { ...prev, index }
    })
  }

  // Swaps the blob URL only once the next file is ready, then frees the old
  // one, so the element never points at a revoked URL mid-playback.
  const swapSrc = (next: string | null) => {
    const prev = srcRef.current
    srcRef.current = next
    setSrc(next)
    if (prev) URL.revokeObjectURL(prev)
  }

  useEffect(() => {
    const media = currentRef.current
    if (!media || allFailed) {
      swapSrc(null)
      return
    }
    let cancelled = false
    media.handle
      .getFile()
      .then((file) => {
        if (!cancelled) swapSrc(URL.createObjectURL(file))
      })
      .catch(() => {
        if (cancelled) return
        setFailStreak((n) => n + 1)
        step(1)
      })
    return () => {
      cancelled = true
    }
    // swapSrc and step only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, allFailed])

  useEffect(() => () => {
    if (srcRef.current) URL.revokeObjectURL(srcRef.current)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return
    video.play().catch(() => {
      // Autoplay with sound is blocked until the user interacts; retry muted.
      if (!video.muted) {
        video.muted = true
        void video.play().catch(() => {})
      }
    })
  }, [src])

  const message = allFailed
    ? 'None of these videos can be played in the browser.'
    : total === 0
      ? isDiscovering
        ? 'Looking for videos…'
        : 'No videos in this view.'
      : null

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* Stays mounted between clips so the viewer's mute and volume choices carry over. */}
        <video
          ref={videoRef}
          src={src ?? undefined}
          className={`max-h-full max-w-full ${src && !message ? '' : 'invisible'}`}
          controls
          muted
          autoPlay
          playsInline
          loop={total === 1}
          onPlaying={() => setFailStreak(0)}
          onEnded={() => step(1)}
          onError={() => {
            if (!srcRef.current) return
            setFailStreak((n) => n + 1)
            step(1)
          }}
        />
        {message && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-neutral-500">
            {message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-3 py-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={total < 2}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-40"
          aria-label="Previous video"
          title="Previous video"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M6 5h2v14H6zM20 5v14L9 12z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={total < 2}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-40"
          aria-label="Next video"
          title="Next video"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          {current && (
            <button
              type="button"
              onClick={() => filterToSubfolder(current)}
              className="block max-w-full truncate text-left text-xs text-neutral-200 underline decoration-neutral-600 underline-offset-2 hover:text-white"
              title={`Show every file in this folder: ${current.relativePath}`}
            >
              {current.relativePath}
            </button>
          )}
        </div>

        {total > 0 && (
          <span className="shrink-0 font-mono text-[11px] text-neutral-500">
            {playlist.index + 1} / {total}
          </span>
        )}
      </div>
    </div>
  )
}
