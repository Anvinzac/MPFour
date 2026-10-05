import { useState, useSyncExternalStore } from 'react'
import { commentStore } from '../lib/commentStore'
import type { MediaFile } from '../types'

function useComments(mediaId: string) {
  return useSyncExternalStore(commentStore.subscribe, () => commentStore.get(mediaId))
}

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

/** Speech-bubble button beside the star; opens an inline field to add a comment. */
export function CellComments({ file }: { file: MediaFile }) {
  const comments = useComments(file.id)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const submit = () => {
    commentStore.add(file.id, draft)
    setDraft('')
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className={`absolute left-11 top-2 z-[12] flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition ${
          open
            ? 'bg-sky-500/90 text-neutral-950'
            : 'bg-black/50 text-neutral-200 hover:bg-black/70'
        }`}
        aria-label={open ? 'Close comment field' : 'Add a comment'}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {comments.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-400 px-1 text-[9px] font-semibold text-neutral-950">
            {comments.length}
          </span>
        )}
      </button>

      {open && (
        <form
          onClick={stop}
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="absolute inset-x-2 top-12 z-[13] flex gap-1.5 rounded-lg bg-black/75 p-1.5 ring-1 ring-white/10 backdrop-blur-sm"
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') setOpen(false)
            }}
            placeholder="Write a comment…"
            className="min-w-0 flex-1 rounded-md bg-neutral-900/90 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none ring-1 ring-white/10 focus:ring-sky-500/70"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="shrink-0 rounded-md bg-sky-500 px-2 py-1 text-xs font-medium text-neutral-950 transition disabled:opacity-40"
          >
            Add
          </button>
        </form>
      )}

      {comments.length > 0 && (
        <div className="pointer-events-none absolute inset-x-2 bottom-9 z-[11] flex flex-wrap-reverse gap-1">
          {comments.map((comment) => (
            <span
              key={comment.id}
              className="pointer-events-auto flex max-w-full items-center gap-1 rounded-md bg-sky-500/90 py-0.5 pl-2 pr-1 text-[11px] font-medium leading-snug text-neutral-950 shadow"
            >
              <span className="break-words">{comment.text}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  commentStore.remove(file.id, comment.id)
                }}
                className="shrink-0 rounded px-0.5 text-neutral-950/60 hover:text-neutral-950"
                aria-label="Remove comment"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  )
}
