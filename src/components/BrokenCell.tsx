import type { MediaFile } from '../types'

interface BrokenCellProps {
  data: MediaFile
  width: number
  height: number
}

/**
 * Always-visible fallback for a slot that could not render or play — a cell
 * must never be left truly empty, even if decode/permission/render fails
 * and no replacement media is available.
 */
export function BrokenCell({ data, width, height }: BrokenCellProps) {
  return (
    <div
      className="gallery-cell relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-neutral-900/80 px-3 text-center ring-1 ring-inset ring-white/5"
      style={{ width, height, contain: 'layout style paint' }}
      title={data.relativePath}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-6 w-6 shrink-0 text-neutral-600"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m0 3.75h.008M4.93 19h14.14c1.36 0 2.21-1.47 1.53-2.65L13.53 4.35c-.68-1.18-2.38-1.18-3.06 0L3.4 16.35C2.72 17.53 3.57 19 4.93 19Z"
        />
      </svg>
      <span className="line-clamp-2 max-w-full break-all text-[11px] text-neutral-500">
        {data.name}
      </span>
    </div>
  )
}
