import { useEffect, useRef, useState } from 'react'
import { CanvasGridPlayer } from '../lib/mediabunnyPlayer'

interface FullScreenVideoProps {
  file: File
}

export function FullScreenVideo({ file }: FullScreenVideoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<CanvasGridPlayer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const player = new CanvasGridPlayer()
    playerRef.current = player

    const mount = async () => {
      try {
        const w = Math.max(1, Math.round(canvas.clientWidth || window.innerWidth))
        const h = Math.max(1, Math.round(canvas.clientHeight || window.innerHeight - 80))
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
        if (!cancelled) {
          setError('This video cannot be decoded in the browser')
        }
      }
    }

    void mount()

    return () => {
      cancelled = true
      player.dispose()
      playerRef.current = null
    }
  }, [file])

  const togglePlay = () => {
    const player = playerRef.current
    if (!player) return
    if (playing) {
      player.stop()
      setPlaying(false)
    } else {
      player.play()
      setPlaying(true)
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
