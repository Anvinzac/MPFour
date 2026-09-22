import { useEffect, useRef, useState } from 'react'
import { CanvasGridPlayer } from '../lib/mediabunnyPlayer'
import {
  createVideoFallback,
  type VideoFallbackHandle,
} from '../lib/videoFallback'

interface FullScreenVideoProps {
  file: File
}

export function FullScreenVideo({ file }: FullScreenVideoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<CanvasGridPlayer | null>(null)
  const videoFallbackRef = useRef<VideoFallbackHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const player = new CanvasGridPlayer()
    playerRef.current = player

    const mount = async () => {
      const w = Math.max(1, Math.round(canvas.clientWidth || window.innerWidth))
      const h = Math.max(1, Math.round(canvas.clientHeight || window.innerHeight - 80))
      try {
        canvas.width = w
        canvas.height = h

        await player.mount(file, canvas, w, h, {
          usePoolSlot: false,
          loopFull: true,
        })
        if (cancelled) return

        await player.showFirstFrame()
        if (cancelled) return

        player.play()
        setPlaying(true)
      } catch {
        if (cancelled) return
        // Tier 2: native <video> fallback (browser's most reliable decoder).
        player.dispose()
        playerRef.current = null
        try {
          const container = canvas.parentElement
          if (!container) throw new Error('no container')
          const handle = await createVideoFallback(file, container, w, h, {
            loopFull: true,
          })
          if (cancelled) {
            handle.dispose()
            return
          }
          videoFallbackRef.current = handle
          handle.video.classList.add('media-cell__canvas--ready', 'max-h-[calc(100vh-5rem)]', 'max-w-full')
          canvas.style.display = 'none'
          setPlaying(true)
        } catch {
          if (!cancelled) {
            setError('This video cannot be decoded in the browser')
          }
        }
      }
    }

    void mount()

    return () => {
      cancelled = true
      player.dispose()
      playerRef.current = null
      videoFallbackRef.current?.dispose()
      videoFallbackRef.current = null
    }
  }, [file])

  const togglePlay = () => {
    if (playerRef.current) {
      if (playing) {
        playerRef.current.stop()
        setPlaying(false)
      } else {
        playerRef.current.play()
        setPlaying(true)
      }
    } else if (videoFallbackRef.current) {
      const video = videoFallbackRef.current.video
      if (playing) {
        video.pause()
        setPlaying(false)
      } else {
        void video.play()
        setPlaying(true)
      }
    }
  }

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>
  }

  return (
    <button
      type="button"
      onClick={togglePlay}
      className="flex max-h-full max-w-full items-center justify-center"
      aria-label={playing ? 'Pause video' : 'Play video'}
    >
      <canvas
        ref={canvasRef}
        className="max-h-[calc(100vh-5rem)] max-w-full"
      />
    </button>
  )
}
