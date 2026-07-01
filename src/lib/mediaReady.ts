export function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error('video load failed'))
    }
    const cleanup = () => {
      video.removeEventListener('loadeddata', done)
      video.removeEventListener('canplay', done)
      video.removeEventListener('error', fail)
    }

    video.addEventListener('loadeddata', done)
    video.addEventListener('canplay', done)
    video.addEventListener('error', fail, { once: true })
  })
}

export function waitForVideoPlaying(video: HTMLVideoElement): Promise<void> {
  if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const onPlaying = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('video play failed'))
    }
    const cleanup = () => {
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
    }

    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError, { once: true })
  })
}

/** Intersection options: any pixel in view counts (peek-friendly). */
export const PEEK_PLAYBACK_IO: IntersectionObserverInit = {
  threshold: 0,
  rootMargin: '120px 0px',
}

/** Wider zone for kicking off prepare before play. */
export const PEEK_PREPARE_IO: IntersectionObserverInit = {
  threshold: 0,
  rootMargin: '120px 0px',
}
