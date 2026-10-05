/**
 * Session-only comments keyed by media id. Kept outside React so they survive
 * cells unmounting as masonic virtualizes the grid; cleared on reload.
 */
export interface CellComment {
  id: number
  text: string
}

const EMPTY: CellComment[] = []
const comments = new Map<string, CellComment[]>()
const listeners = new Set<() => void>()
let nextId = 1

function emit() {
  for (const listener of listeners) listener()
}

export const commentStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get(mediaId: string): CellComment[] {
    return comments.get(mediaId) ?? EMPTY
  },
  add(mediaId: string, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    comments.set(mediaId, [...commentStore.get(mediaId), { id: nextId++, text: trimmed }])
    emit()
  },
  remove(mediaId: string, commentId: number) {
    const next = commentStore.get(mediaId).filter((comment) => comment.id !== commentId)
    if (next.length > 0) comments.set(mediaId, next)
    else comments.delete(mediaId)
    emit()
  },
}
