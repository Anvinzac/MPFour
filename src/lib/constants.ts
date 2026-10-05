/** Max concurrent Mediabunny canvas decoders in the grid (memory-safe). */
export const MAX_ACTIVE_CANVAS_PLAYERS = 5
export const PREVIEW_DURATION_SEC = 5
/** Files above this limit are excluded during scan to avoid memory crashes. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024
/** Files below this are skipped during scan — mostly thumbnails, icons and cache images. */
export const MIN_FILE_BYTES = 30 * 1024
/** Above this size, grid uses a byte-range preview blob instead of the full file. */
export const LARGE_VIDEO_BYTES = 20 * 1024 * 1024
/** Files added to the visible grid per scaffold step (mixed across folders). */
export const SCAFFOLD_BATCH_SIZE = 12
/** Start loading the next batch when the viewport is this many items from the end. */
export const SCAFFOLD_LOAD_AHEAD = 4
/** Validation rounds per prepared batch before giving up on a buffer full of unplayable files. */
export const PREPARE_MAX_ATTEMPTS = 3
/** How far below the viewport (px) the bottom sentinel starts requesting more. */
export const NEAR_END_MARGIN_PX = 1200
/** Max files collected per folder in the first quick pass (feeds the buffer). */
export const QUICK_SCAN_MAX_FILES = 20
/** Directories visited (in random order) during the quick pass before handing off to the full scan. */
export const QUICK_SCAN_MAX_DIRS = 40
/**
 * Phase 1 of the mixed gallery: every directory contributes 2 random
 * representatives for a quick survey. Phase 2 then streams the rest,
 * randomly mixed across directories, until every file has been shown.
 */
export const OVERVIEW_MIN_PER_DIR = 2
export const OVERVIEW_MAX_PER_DIR = 2
/** Raw files emitted per background batch while the user browses. */
export const BACKGROUND_SCAN_BATCH_SIZE = 20
/** Emit a partial background batch after this long, so slow folders still trickle in (ms). */
export const BACKGROUND_SCAN_FLUSH_MS = 400
/** Byte-range slices to try for large-file previews (moov-at-start MP4/MOV). */
export const PREVIEW_SLICE_ATTEMPTS = [
  2 * 1024 * 1024,
  4 * 1024 * 1024,
  8 * 1024 * 1024,
] as const
/** Interval between playback health checks while a canvas player is active (ms). */
export const PLAYBACK_HEALTH_CHECK_INTERVAL_MS = 3000
/** Consecutive stalled health checks before declaring a player frozen. */
export const PLAYBACK_STALL_THRESHOLD = 2
/**
 * A grid video out of view this long releases its decoder and pool slot
 * (the last frame stays painted). Idle decoders otherwise starve visible
 * cells and get reclaimed by the browser, leaving dead players behind.
 */
export const OFFSCREEN_RELEASE_MS = 1500
/** Automatic remounts after a mid-playback failure before asking the user to reload. */
export const MAX_AUTO_RECOVERIES = 2
/** Max wait for a canvas pool slot before falling back to a <video> element (ms). */
export const CANVAS_SLOT_TIMEOUT_MS = 8000
/** Timeout for the <video> fallback to start playing (ms). */
export const VIDEO_FALLBACK_TIMEOUT_MS = 6000
