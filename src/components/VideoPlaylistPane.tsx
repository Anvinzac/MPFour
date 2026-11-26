import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** The clip that should be on screen. */
  index: number
}

/** What one of the two stacked <video> elements holds. */
interface DeckSlot {
  id: string | null
  url: string | null
  /** Paused on its first frame (or playing) with that frame decoded. */
  ready: boolean
}

type SlotIndex = 0 | 1
type Pair<T> = [T, T]

/** Length of the fade between a clip's frozen last frame and the next clip's first frame. */
const FADE_MS = 200

const EMPTY_SLOT: DeckSlot = { id: null, url: null, ready: false }

function withSlot<T>(pair: Pair<T>, slot: SlotIndex, value: T): Pair<T> {
  const next: Pair<T> = [pair[0], pair[1]]
  next[slot] = value
  return next
}

function otherSlot(slot: SlotIndex): SlotIndex {
  return slot === 0 ? 1 : 0
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

/** The nearest playable clip in `direction`, or null when no other clip can play. */
function stepPlayable(
  items: MediaFile[],
  from: number,
  direction: 1 | -1,
  failed: Set<string>,
): number | null {
  const total = items.length
  for (let offset = 1; offset < total; offset++) {
    const index = (from + direction * offset + total * offset) % total
    if (!failed.has(items[index].id)) return index
  }
  return null
}

/**
 * Two stacked, fully opaque <video> decks take turns. The deck underneath
 * preloads the next clip and sits paused on its first frame. When the clip on
 * top ends (or the viewer skips), it freezes on its current frame and fades
 * out, revealing that first frame; once the fade is done the new clip starts
 * playing and the old deck, now underneath, preloads the clip after it.
 *
 * Only the top deck's opacity changes, over a deck that is already painted,
 * so the picture never dips through black mid-fade.
 */
export function VideoPlaylistPane({
  videos,
  resetKey,
  isDiscovering,
}: VideoPlaylistPaneProps) {
  const filterToSubfolder = useFilterToSubfolder()
  const deckA = useRef<HTMLVideoElement>(null)
  const deckB = useRef<HTMLVideoElement>(null)
  const decks = [deckA, deckB] as const
  const [playlist, setPlaylist] = useState<Playlist>(() => ({
    key: resetKey,
    items: shuffle(videos),
    index: 0,
  }))
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set())
  const [slots, setSlots] = useState<Pair<DeckSlot>>([EMPTY_SLOT, EMPTY_SLOT])
  const [active, setActive] = useState<SlotIndex>(0)
  const [fading, setFading] = useState(false)
  const fadingRef = useRef(false)
  fadingRef.current = fading
  const fadeTimerRef = useRef(0)
  const loadTokensRef = useRef<Pair<number>>([0, 0])
  const urlsRef = useRef<Pair<string | null>>([null, null])

  const { items, index } = playlist
  const total = items.length
  const failedCount = items.filter((file) => failedIds.has(file.id)).length
  const allFailed = total > 0 && failedCount >= total
  const target = total > 0 && !allFailed ? items[index] : null
  const standby = otherSlot(active)
  const activeHoldsTarget = target !== null && slots[active].id === target.id
  const nextIndex = target ? stepPlayable(items, index, 1, failedIds) : null
  const hasNext = nextIndex !== null
  // The deck underneath preloads whatever comes next: the target itself while
  // switching to it, otherwise the clip after it.
  const standbyTarget = !target
    ? null
    : !activeHoldsTarget
      ? target
      : nextIndex === null
        ? null
        : items[nextIndex]

  useEffect(() => {
    setPlaylist((prev) => reconcilePlaylist(prev, videos, resetKey))
  }, [videos, resetKey])

  useEffect(() => {
    setFailedIds(new Set())
  }, [resetKey])

  const markFailed = useCallback((id: string) => {
    setFailedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  const goTo = useCallback(
    (direction: 1 | -1) => {
      setPlaylist((prev) => {
        const next = stepPlayable(prev.items, prev.index, direction, failedIds)
        return next === null ? prev : { ...prev, index: next }
      })
    },
    [failedIds],
  )

  // A target that failed to load moves on to the next playable clip.
  useEffect(() => {
    if (total === 0 || allFailed || !failedIds.has(items[index].id)) return
    const next = stepPlayable(items, index, 1, failedIds)
    if (next !== null) setPlaylist((prev) => ({ ...prev, index: next }))
  }, [items, index, total, failedIds, allFailed])

  const loadSlot = useCallback(
    (slot: SlotIndex, media: MediaFile | null) => {
      const token = ++loadTokensRef.current[slot]
      const replaceUrl = (url: string | null) => {
        const old = urlsRef.current[slot]
        urlsRef.current[slot] = url
        if (old) URL.revokeObjectURL(old)
      }
      if (!media) {
        // Dropping the src attribute alone doesn't stop a loaded clip.
        const video = decks[slot].current
        if (video) {
          video.pause()
          video.removeAttribute('src')
          video.load()
        }
        replaceUrl(null)
        setSlots((prev) => withSlot(prev, slot, EMPTY_SLOT))
        return
      }
      setSlots((prev) => withSlot(prev, slot, { id: media.id, url: null, ready: false }))
      media.handle
        .getFile()
        .then((file) => {
          if (loadTokensRef.current[slot] !== token) return
          const url = URL.createObjectURL(file)
          replaceUrl(url)
          setSlots((prev) => withSlot(prev, slot, { id: media.id, url, ready: false }))
        })
        .catch(() => {
          if (loadTokensRef.current[slot] === token) markFailed(media.id)
        })
    },
    // decks are refs and never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markFailed],
  )

  // Nothing left to play: stop and empty both decks.
  useEffect(() => {
    if (target) return
    window.clearTimeout(fadeTimerRef.current)
    setFading(false)
    loadSlot(0, null)
    loadSlot(1, null)
  }, [target, loadSlot])

  // Preload the deck underneath. It is fully covered, so swapping its clip is invisible.
  const standbyTargetId = standbyTarget?.id ?? null
  const standbyTargetRef = useRef(standbyTarget)
  standbyTargetRef.current = standbyTarget
  useEffect(() => {
    if (!standbyTargetId || fading) return
    if (slots[standby].id === standbyTargetId) return
    loadSlot(standby, standbyTargetRef.current)
  }, [standby, standbyTargetId, fading, slots, loadSlot])

  /** Ends a fade: the revealed deck goes on top and starts playing. */
  const finishFade = useCallback(() => {
    if (!fadingRef.current) return
    window.clearTimeout(fadeTimerRef.current)
    fadingRef.current = false
    setFading(false)
    setActive((prev) => otherSlot(prev))
  }, [])

  // Once the deck underneath shows the target's first frame, freeze the clip
  // on top and fade it out.
  useEffect(() => {
    if (!target || activeHoldsTarget || fading) return
    const slot = slots[standby]
    if (slot.id !== target.id || !slot.ready) return
    const below = decks[standby].current
    if (below && below.currentTime > 0) {
      // A deck reused for "previous" still sits where it stopped; rewind
      // first, and onSeeked marks it ready again.
      setSlots((prev) => withSlot(prev, standby, { ...prev[standby], ready: false }))
      below.currentTime = 0
      return
    }
    decks[active].current?.pause()
    setFading(true)
    // transitionend normally ends the fade; this covers a tab that isn't painting.
    window.clearTimeout(fadeTimerRef.current)
    fadeTimerRef.current = window.setTimeout(finishFade, FADE_MS + 150)
    // decks are refs and never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, activeHoldsTarget, fading, slots, standby, active, finishFade])

  // Play the deck that just came on top, from the first frame it was showing.
  const activeReady = slots[active].ready
  const activeUrl = slots[active].url
  useEffect(() => {
    const video = decks[active].current
    if (!video || !activeReady) return
    video.play().catch(() => {
      // Sound autoplay is blocked until the viewer interacts; retry muted.
      if (video.muted) return
      for (const deck of decks) if (deck.current) deck.current.muted = true
      void video.play().catch(() => {})
    })
    // decks are refs and never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeReady, activeUrl])

  useEffect(() => {
    const urls = urlsRef.current
    const fadeTimer = fadeTimerRef
    return () => {
      window.clearTimeout(fadeTimer.current)
      for (const url of urls) if (url) URL.revokeObjectURL(url)
    }
  }, [])

  const syncAudio = (from: HTMLVideoElement) => {
    for (const deck of decks) {
      const video = deck.current
      if (!video || video === from) continue
      video.muted = from.muted
      video.volume = from.volume
    }
  }

  const markReady = (slot: SlotIndex) => {
    setSlots((prev) =>
      prev[slot].ready || !prev[slot].url
        ? prev
        : withSlot(prev, slot, { ...prev[slot], ready: true }),
    )
  }

  const activeId = slots[active].id
  const current = activeId ? (items.find((file) => file.id === activeId) ?? null) : null
  const currentIndex = current ? items.indexOf(current) : -1
  const playableCount = total - failedCount

  const message = allFailed
    ? 'None of these videos can be played in the browser.'
    : total === 0
      ? isDiscovering
        ? 'Looking for videos…'
        : 'No videos in this view.'
      : null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-black">
      <div className="relative min-h-0 flex-1">
        {([0, 1] as const).map((slot) => {
          const isActive = slot === active
          const isFadingOut = isActive && fading
          return (
            <video
              key={slot}
              ref={decks[slot]}
              src={slots[slot].url ?? undefined}
              // Opaque black so each deck fully covers the one beneath, letterbox bars included.
              className="absolute inset-0 h-full w-full bg-black object-contain"
              style={{
                opacity: isFadingOut || message ? 0 : 1,
                // Only the fade-out animates; everything else snaps while covered.
                transition: isFadingOut ? `opacity ${FADE_MS}ms linear` : 'none',
                zIndex: isActive ? 2 : 1,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
              controls={isActive && !fading && !!slots[slot].url}
              muted
              preload="auto"
              playsInline
              loop={isActive && !hasNext}
              onLoadedData={() => markReady(slot)}
              onSeeked={() => markReady(slot)}
              onTransitionEnd={(event) => {
                if (event.propertyName === 'opacity' && isFadingOut) finishFade()
              }}
              // The clip stops on its last frame; the fade starts once the next one is ready.
              onEnded={() => {
                if (isActive) goTo(1)
              }}
              onVolumeChange={(event) => {
                if (isActive) syncAudio(event.currentTarget)
              }}
              onError={() => {
                const id = slots[slot].id
                if (id && slots[slot].url) markFailed(id)
              }}
            />
          )
        })}
        {message && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-neutral-500">
            {message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-3 py-2">
        <button
          type="button"
          onClick={() => goTo(-1)}
          disabled={playableCount < 2}
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
          onClick={() => goTo(1)}
          disabled={playableCount < 2}
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

        {currentIndex >= 0 && (
          <span className="shrink-0 font-mono text-[11px] text-neutral-500">
            {currentIndex + 1} / {total}
          </span>
        )}
      </div>
    </div>
  )
}
