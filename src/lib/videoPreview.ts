import {
  LARGE_VIDEO_BYTES,
  PREVIEW_DURATION_SEC,
  PREVIEW_SLICE_ATTEMPTS,
} from './constants'

export interface VideoPreviewSource {
  url: string
  isPreviewOnly: boolean
}

function probeVideoUrl(url: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    const timer = window.setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)

    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
    }

    video.addEventListener(
      'loadedmetadata',
      () => {
        cleanup()
        resolve(video.videoWidth > 0)
      },
      { once: true },
    )

    video.addEventListener(
      'error',
      () => {
        cleanup()
        resolve(false)
      },
      { once: true },
    )

    video.src = url
  })
}

/**
 * For large videos, build a small blob from the file start so the browser
 * only fetches/decodes enough for a short preview. Falls back to full file
 * with time-based 5s looping if slicing fails (e.g. moov atom at file end).
 */
export async function createVideoPreviewSource(
  file: File,
): Promise<VideoPreviewSource> {
  if (file.size <= LARGE_VIDEO_BYTES) {
    return {
      url: URL.createObjectURL(file),
      isPreviewOnly: false,
    }
  }

  for (const bytes of PREVIEW_SLICE_ATTEMPTS) {
    const sliceSize = Math.min(file.size, bytes)
    const slice = file.slice(0, sliceSize, file.type || 'video/mp4')
    const url = URL.createObjectURL(slice)
    const ok = await probeVideoUrl(url)
    if (ok) {
      return { url, isPreviewOnly: true }
    }
    URL.revokeObjectURL(url)
  }

  throw new Error('preview slice failed — avoid loading full file into memory')
}

export function attachPreviewLoop(
  video: HTMLVideoElement,
  durationSec = PREVIEW_DURATION_SEC,
): () => void {
  video.loop = false

  const onTimeUpdate = () => {
    if (video.currentTime >= durationSec) {
      video.currentTime = 0.01
    }
  }

  video.addEventListener('timeupdate', onTimeUpdate)
  return () => video.removeEventListener('timeupdate', onTimeUpdate)
}

export async function createFullMediaUrl(
  handle: FileSystemFileHandle,
): Promise<string> {
  const file = await handle.getFile()
  return URL.createObjectURL(file)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
