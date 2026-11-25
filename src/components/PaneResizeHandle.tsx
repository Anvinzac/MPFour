import { useRef, useState } from 'react'
import {
  DEFAULT_PANE_WIDTH,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
} from '../hooks/usePaneWidth'

interface PaneResizeHandleProps {
  /** Pane width as a percentage of the window. */
  width: number
  onResize: (percent: number) => void
}

const KEY_STEP = 2

/**
 * Drag strip on the player pane's right edge. Double-click resets the width;
 * arrow keys nudge it when focused.
 */
export function PaneResizeHandle({ width, onResize }: PaneResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef(0)

  const resizeTo = (clientX: number) => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      onResize((clientX / window.innerWidth) * 100)
    })
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize video player"
      aria-valuenow={width}
      aria-valuemin={MIN_PANE_WIDTH}
      aria-valuemax={MAX_PANE_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (dragging) resizeTo(event.clientX)
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragging(false)
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onResize(DEFAULT_PANE_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onResize(width - KEY_STEP)
        else if (event.key === 'ArrowRight') onResize(width + KEY_STEP)
        else return
        event.preventDefault()
      }}
      className="group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none"
    >
      <div
        className={`h-full w-px transition-colors ${
          dragging
            ? 'bg-sky-400'
            : 'bg-neutral-800 group-hover:bg-neutral-500 group-focus-visible:bg-sky-400'
        }`}
      />
      {/* Covers the page while dragging so the gallery and video don't steal the pointer. */}
      {dragging && <div className="fixed inset-0 cursor-col-resize" />}
    </div>
  )
}
