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
  ready: boolean
}

type SlotIndex = 0 | 1
type Pair<T> = [T, T]

/** Crossfade length, and how long before a clip's end the next one starts fading in. */
const FADE_MS = 200
const FADE_SEC = FADE_MS / 1000

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
 * Two stacked <video> decks take turns. The hidden deck preloads the next
 * clip; FADE_MS before the visible clip ends, the hidden deck starts playing
 * and fades in on top. The covered deck then hides and preloads the clip
 * after that.
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
  const [shown, setShown] = useState<Pair<boolean>>([false, false])
  const activeRef = useRef(active)
  activeRef.current = active
  const fadeTimerRef = useRef(0)
  const loadTokensRef = useRef<Pair<number>>([0, 0])
  const urlsRef = useRef<Pair<string | null>>([null, null])
  // Clip id the near-end check already advanced from, so it fires once per clip.
  const advancedFromRef = useRef<string | null>(null)

  const { items, index } = playlist
  const total = items.length
  const failedCount = items.filter((file) => failedIds.has(file.id)).length
  const allFailed = total > 0 && failedCount >= total
  const target = total > 0 && !allFailed ? items[index] : null
  const standby = otherSlot(active)
  const activeHoldsTarget = target !== null && slots[active].id === target.id
  const nextIndex = target ? stepPlayable(items, index, 1, failedIds) : null
  // The hidden deck preloads whatever comes next: the target itself while
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
    loadSlot(0, null)
    loadSlot(1, null)
    setShown([false, false])
  }, [target, loadSlot])

  // Preload the hidden deck once it has finished fading out.
  const standbyTargetId = standbyTarget?.id ?? null
  const standbyTargetRef = useRef(standbyTarget)
  standbyTargetRef.current = standbyTarget
  useEffect(() => {
    if (!standbyTargetId || shown[standby]) return
    if (slots[standby].id === standbyTargetId) return
    loadSlot(standby, standbyTargetRef.current)
  }, [standby, standbyTargetId, shown, slots, loadSlot])

  // Switch decks once the hidden one holds the target and can play it.
  useEffect(() => {
    if (!target || activeHoldsTarget) return
    const slot = slots[standby]
    if (slot.id !== target.id || !slot.ready) return
    window.clearTimeout(fadeTimerRef.current)
    setActive(standby)
  }, [target, activeHoldsTarget, slots, standby])

  /** Hides and pauses the deck beneath `slot`, freeing it to preload. */
  const hideCovered = useCallback(
    (slot: SlotIndex) => {
      if (activeRef.current !== slot) return
      window.clearTimeout(fadeTimerRef.current)
      const covered = otherSlot(slot)
      decks[covered].current?.pause()
      setShown((prev) => (prev[covered] ? withSlot(prev, covered, false) : prev))
    },
    // decks are refs and never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * Fades `slot` in on top. The deck beneath hides when the fade's
   * transitionend fires; the timer covers fades that never run (the deck was
   * already visible, or the tab isn't painting).
   */
  const reveal = useCallback(
    (slot: SlotIndex) => {
      if (activeRef.current !== slot) return
      setShown((prev) => (prev[slot] ? prev : withSlot(prev, slot, true)))
      window.clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = window.setTimeout(() => hideCovered(slot), FADE_MS * 4)
    },
    [hideCovered],
  )

  // Start the active deck from the top whenever it takes over.
  const activeReady = slots[active].ready
  const activeUrl = slots[active].url
  useEffect(() => {
    const video = decks[active].current
    if (!video || !activeReady) return
    advancedFromRef.current = null
    video.currentTime = 0
    video
      .play()
      .catch(() => {
        // Sound autoplay is blocked until the viewer interacts; retry muted.
        if (video.muted) throw new Error('play blocked')
        for (const deck of decks) if (deck.current) deck.current.muted = true
        return video.play()
      })
      .then(
        () => reveal(active),
        () => {},
      )
    // decks are refs and never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeReady, activeUrl, reveal])

  // Start the next clip FADE_MS before the current one ends. A timer aimed at
  // that moment, re-aimed on every seek, pause or rate change, stays accurate
  // where per-frame polling would drift with the page's frame rate.
  const activeId = slots[active].id
  const hasNext = nextIndex !== null
  useEffect(() => {
    const video = decks[active].current
    if (!hasNext || !video || !activeId) return
    let timer = 0
    const remaining = () => (video.duration - video.currentTime) / (video.playbackRate || 1)
    const fire = () => {
      timer = 0
      if (video.paused || advancedFromRef.current === activeId) return
      if (remaining() > FADE_SEC + 0.05) {
        schedule()
        return
      }
      advancedFromRef.current = activeId
      goTo(1)
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = 0
      const left = remaining()
      if (video.paused || !Number.isFinite(left)) return
      timer = window.setTimeout(fire, Math.max(0, (left - FADE_SEC) * 1000))
    }
    const events = ['playing', 'pause', 'seeked', 'ratechange', 'durationchange']
    for (const name of events) video.addEventListener(name, schedule)
    schedule()
    return () => {
      window.clearTimeout(timer)
      for (const name of events) video.removeEventListener(name, schedule)
    }
    // decks are refs and never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeId, hasNext, goTo])

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
          const isShown = shown[slot] && !message
          return (
            <video
              key={slot}
              ref={decks[slot]}
              src={slots[slot].url ?? undefined}
              // Opaque black so the letterbox bars cover the clip beneath during a fade.
              className="absolute inset-0 h-full w-full bg-black object-contain"
              style={{
                opacity: isShown ? 1 : 0,
                // Fades in; hides instantly once covered.
                transition: isShown ? `opacity ${FADE_MS}ms linear` : 'none',
                zIndex: isActive ? 2 : 1,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
              controls={isActive && isShown}
              muted
              preload="auto"
              playsInline
              loop={isActive && !hasNext}
              onCanPlay={() => {
                setSlots((prev) =>
                  prev[slot].ready || !prev[slot].url
                    ? prev
                    : withSlot(prev, slot, { ...prev[slot], ready: true }),
                )
              }}
              onTransitionEnd={(event) => {
                if (event.propertyName === 'opacity' && isActive && isShown) hideCovered(slot)
              }}
              onEnded={() => {
                // Fallback for when the near-end check didn't run (background tab).
                if (isActive && advancedFromRef.current !== slots[slot].id) {
                  advancedFromRef.current = slots[slot].id
                  goTo(1)
                }
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
