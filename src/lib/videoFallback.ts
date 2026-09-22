import { VIDEO_FALLBACK_TIMEOUT_MS } from './constants'
import { attachPreviewLoop, createVideoPreviewSource } from './videoPreview'

export interface VideoFallbackHandle {
  video: HTMLVideoElement
  dispose: () => void
}

export interface VideoFallbackOptions {
  /** Loop the entire clip (fullscreen). Grid defaults to a short preview window. */
  loopFull?: boolean
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  mov: 'video/quicktime',
}

function guessMimeType(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return ''
  const ext = name.slice(dot + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? ''
}

/** Returns true when the browser might play this MIME type (not empty string). */
function canPlayVideo(mimeType: string): boolean {
  const video = document.createElement('video')
  return video.canPlayType(mimeType) !== ''
}

function waitForVideoPlaying(
  video: HTMLVideoElement,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
    }

    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('video fallback timeout'))
    }, timeoutMs)

    const onPlaying = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const onError = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('video playback error'))
    }

    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)

    void video.play().catch((err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    })
  })
}

/**
 * Native <video> fallback for when the WebCodecs/canvas player fails or
 * stalls. Uses the browser's hardware-accelerated media pipeline — the most
 * reliable decode path available (H.264/AVC in MP4 is universally supported).
 *
 * For large files (>20MB) it slices a small blob from the file start so the
 * browser only decodes enough for a short preview. Falls back to the full
 * file URL when slicing is unavailable (e.g. moov atom at file end).
 */
export async function createVideoFallback(
  file: File,
  container: HTMLElement,
  width: number,
  height: number,
  options: VideoFallbackOptions = {},
): Promise<VideoFallbackHandle> {
  const mimeType = file.type || guessMimeType(file.name)
  if (mimeType && !canPlayVideo(mimeType)) {
    throw new Error(`unsupported video type: ${mimeType}`)
  }

  // Try a byte-range preview slice for large files; fall back to the full
  // file URL if slicing fails (e.g. moov atom at file end).
  let url: string
  try {
    const source = await createVideoPreviewSource(file)
    url = source.url
  } catch {
    url = URL.createObjectURL(file)
  }

  const video = document.createElement('video')
  video.className = 'media-cell__canvas h-full w-full'
  video.muted = true
  video.playsInline = true
  video.width = Math.max(1, Math.round(width))
  video.height = Math.max(1, Math.round(height))
  video.src = url
  container.appendChild(video)

  let detachLoop: (() => void) | null = null
  if (options.loopFull) {
    video.loop = true
  } else {
    detachLoop = attachPreviewLoop(video)
  }

  await waitForVideoPlaying(video, VIDEO_FALLBACK_TIMEOUT_MS)

  const dispose = () => {
    if (detachLoop) {
      detachLoop()
      detachLoop = null
    }
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
    video.remove()
  }

  return { video, dispose }
}
