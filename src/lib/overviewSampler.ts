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
 * Each directory gets a random quota (1–2) the first time it is seen; files
 * beyond that quota are kept in the pool but never shown in the mixed view.
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

/** Fresh random overview of a pool: 1–2 files per directory. */
export function sampleOverview(pool: MediaFile[], quota: OverviewQuota): MediaFile[] {
  quota.reset()
  return quota.filter(shuffle(pool))
}
