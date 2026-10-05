import { OVERVIEW_MAX_PER_DIR, OVERVIEW_MIN_PER_DIR } from './constants'
import { dirname } from './pathUtils'
import { shuffle } from './shuffle'
import type { MediaFile } from '../types'

export function directoryKey(file: MediaFile): string {
  return `${file.folderId}:${dirname(file.relativePath)}`
}

export function rollDirectoryQuota(): number {
  const span = OVERVIEW_MAX_PER_DIR - OVERVIEW_MIN_PER_DIR + 1
  return OVERVIEW_MIN_PER_DIR + Math.floor(Math.random() * span)
}

/**
 * Tracks how many files each directory has contributed to the overview.
 * Each directory gets a quota the first time it is seen; files beyond it
 * wait in the pool for the continuation phase.
 */
export class OverviewQuota {
  private quotas = new Map<string, number>()
  private counts = new Map<string, number>()
  private admitted = new Set<string>()

  admit(file: MediaFile): boolean {
    if (this.admitted.has(file.id)) return true
    const key = directoryKey(file)
    let quota = this.quotas.get(key)
    if (quota === undefined) {
      quota = rollDirectoryQuota()
      this.quotas.set(key, quota)
    }
    const count = this.counts.get(key) ?? 0
    if (count >= quota) return false
    this.counts.set(key, count + 1)
    this.admitted.add(file.id)
    return true
  }

  /** Frees a directory slot (e.g. the file turned out unplayable). */
  release(file: MediaFile): void {
    if (!this.admitted.delete(file.id)) return
    const key = directoryKey(file)
    this.counts.set(key, Math.max(0, (this.counts.get(key) ?? 1) - 1))
  }

  isAdmitted(file: MediaFile): boolean {
    return this.admitted.has(file.id)
  }

  filter(files: MediaFile[]): MediaFile[] {
    return files.filter((file) => this.admit(file))
  }

  reset(): void {
    this.quotas.clear()
    this.counts.clear()
    this.admitted.clear()
  }
}

/**
 * After the overview is exhausted, keep streaming with no per-directory
 * ceiling: one random file per directory per round, least-shown directories
 * first, so the grid stays spread out while it goes deeper.
 */
export function pickContinuation(
  pool: MediaFile[],
  excludedIds: Set<string>,
  shownPerDir: Map<string, number>,
  count: number,
): MediaFile[] {
  if (count <= 0) return []
  const byDir = new Map<string, MediaFile[]>()
  for (const file of pool) {
    if (excludedIds.has(file.id)) continue
    const key = directoryKey(file)
    const list = byDir.get(key)
    if (list) list.push(file)
    else byDir.set(key, [file])
  }
  if (byDir.size === 0) return []

  const shown = new Map(shownPerDir)
  const queues = new Map(
    [...byDir].map(([key, files]) => [key, shuffle(files)] as const),
  )
  const picked: MediaFile[] = []

  while (picked.length < count && queues.size > 0) {
    const round = shuffle([...queues.keys()]).sort(
      (a, b) => (shown.get(a) ?? 0) - (shown.get(b) ?? 0),
    )
    for (const key of round) {
      const queue = queues.get(key)!
      picked.push(queue.pop()!)
      shown.set(key, (shown.get(key) ?? 0) + 1)
      if (queue.length === 0) queues.delete(key)
      if (picked.length >= count) break
    }
  }
  return picked
}

/** Fresh random overview of a pool, capped per directory by the quota. */
export function sampleOverview(pool: MediaFile[], quota: OverviewQuota): MediaFile[] {
  quota.reset()
  return quota.filter(shuffle(pool))
}
