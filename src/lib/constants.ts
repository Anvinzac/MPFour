/** Max concurrent Mediabunny canvas decoders in the grid (memory-safe). */
export const MAX_ACTIVE_CANVAS_PLAYERS = 5
export const PREVIEW_DURATION_SEC = 5
/** Files above this limit are excluded during scan to avoid memory crashes. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024
/** Above this size, grid uses a byte-range preview blob instead of the full file. */
export const LARGE_VIDEO_BYTES = 20 * 1024 * 1024
/** Files added to the visible grid per scaffold step (mixed across folders). */
export const SCAFFOLD_BATCH_SIZE = 12
/** Start loading the next batch when the viewport is this many items from the end. */
export const SCAFFOLD_LOAD_AHEAD = 4
/** Max files collected per folder in the first quick pass (feeds the buffer). */
export const QUICK_SCAN_MAX_FILES = 20
/** Shallow sample per immediate sub-folder for variety in the quick pass. */
export const QUICK_SCAN_FILES_PER_SUBDIR = 3
/** Max immediate sub-folders sampled during the quick pass (full tree scanned later). */
export const QUICK_SCAN_MAX_SUBDIRS = 4
/** Nested sub-folders peeked per sampled branch during quick pass. */
export const QUICK_SCAN_NESTED_SUBDIRS = 3
/** Raw files validated per background batch while the user browses. */
export const BACKGROUND_SCAN_BATCH_SIZE = 20
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
/** Max wait for a canvas pool slot before falling back to a <video> element (ms). */
export const CANVAS_SLOT_TIMEOUT_MS = 8000
/** Timeout for the <video> fallback to start playing (ms). */
export const VIDEO_FALLBACK_TIMEOUT_MS = 6000
