import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  countByKind,
  dedupeMediaFiles,
  filterByFolder,
  formatScanSkipNotice,
  pickDirectory,
} from '../lib/fileScanner'
import {
  ensureReadPermission,
  getActiveFolderIds,
  getFolder,
  queryReadPermission,
  saveFolder,
  setActiveFolderIds,
  touchFolder,
} from '../lib/folderStore'
import { aspectRatioProbe } from '../lib/aspectRatioProbe'
import { PREPARE_MAX_ATTEMPTS, SCAFFOLD_BATCH_SIZE } from '../lib/constants'
import { filterPlayableMedia } from '../lib/mediaValidator'
import {
  createDiversifiedSlots,
  appendDisplaySlots,
  pickRandomEqualMix,
  pickSlotReplacement,
} from '../lib/gallerySlots'
import {
  filterFavoriteFiles,
  filterFilesInSubfolder,
} from '../lib/mediaFilter'
import { getMediaStats } from '../lib/mediaStats'
import {
  directoryKey,
  OverviewQuota,
  pickContinuation,
  sampleOverview,
} from '../lib/overviewSampler'
import { formatSubfolderLabel } from '../lib/pathUtils'
import {
  backgroundDualScanFolder,
  progressiveDualScanFolder,
  quickDualScanFolder,
} from '../lib/progressiveScan'
import type {
  ActiveFolder,
  GallerySlot,
  GalleryView,
  MediaFile,
  MediaKind,
} from '../types'
import type { ScanResult } from '../lib/fileScanner'

function mixDisplaySlots(pool: MediaFile[]): GallerySlot[] {
  return createDiversifiedSlots(pool)
}

/** Pre-probe aspect ratios so cells are created with correct dimensions. */
function probeAspectRatios(files: MediaFile[]): Promise<void> {
  return aspectRatioProbe.probeBatch(
    files.map((file) => ({ id: file.id, handle: file.handle, kind: file.kind })),
  )
}

function resolveVisiblePool(
  pool: MediaFile[],
  view: GalleryView,
  favoriteIds: Set<string>,
): MediaFile[] {
  if (view.mode === 'favorites') {
    return filterFavoriteFiles(pool, favoriteIds)
  }
  if (view.mode === 'subfolder') {
    return filterFilesInSubfolder(
      pool,
      view.filter.folderId,
      view.filter.directoryPath,
    )
  }
  return pool
}

/**
 * Replacement for a failed overview cell that keeps the per-directory overview
 * rule: same directory first, then a directory not yet on screen.
 */
function pickOverviewReplacement(
  pool: MediaFile[],
  slots: GallerySlot[],
  failed: MediaFile,
  tried: Set<string>,
  kind: MediaKind,
): MediaFile | null {
  const onScreenIds = new Set(slots.map((slot) => slot.media.id))
  const failedDir = directoryKey(failed)
  const sameDir = pool.filter((file) => directoryKey(file) === failedDir)
  const fromSameDir = pickSlotReplacement(sameDir, onScreenIds, tried, kind)
  if (fromSameDir) return fromSameDir

  const shownDirs = new Set(slots.map((slot) => directoryKey(slot.media)))
  const unseenDirs = pool.filter((file) => !shownDirs.has(directoryKey(file)))
  return pickSlotReplacement(unseenDirs, onScreenIds, tried, kind)
}

function mergeSkipTotals(
  current: { overLimit: number; unplayable: number },
  batch: Pick<ScanResult, 'skippedOverLimit' | 'skippedUnplayable'>,
) {
  return {
    overLimit: current.overLimit + batch.skippedOverLimit,
    unplayable: current.unplayable + batch.skippedUnplayable,
  }
}

/** A view switch replaces the whole list, so it starts from the top, not mid-way. */
function scrollToTop(): void {
  window.scrollTo({ top: 0, left: 0 })
}

function countShownPerDirectory(files: MediaFile[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of files) {
    const key = directoryKey(file)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function removeFromBuffer(
  buffer: Map<string, MediaFile[]>,
  files: MediaFile[],
): void {
  const ids = new Set(files.map((file) => file.id))
  for (const [folderId, list] of buffer) {
    buffer.set(
      folderId,
      list.filter((file) => !ids.has(file.id)),
    )
  }
}

function enqueueUndisplayed(
  buffer: Map<string, MediaFile[]>,
  folderId: string,
  files: MediaFile[],
): void {
  if (files.length === 0) return
  const list = buffer.get(folderId) ?? []
  const seen = new Set(list.map((file) => file.id))
  for (const file of files) {
    if (seen.has(file.id)) continue
    seen.add(file.id)
    list.push(file)
  }
  buffer.set(folderId, list)
}

export function useMediaPool(favoriteIds: Set<string> = new Set()) {
  const [activeFolders, setActiveFolders] = useState<ActiveFolder[]>([])
  const [mediaPool, setMediaPool] = useState<MediaFile[]>([])
  const [displaySlots, setDisplaySlots] = useState<GallerySlot[]>([])
  const [legacyPool, setLegacyPool] = useState<MediaFile[]>([])
  const [legacyDisplaySlots, setLegacyDisplaySlots] = useState<GallerySlot[]>([])
  const [galleryView, setGalleryView] = useState<GalleryView>({ mode: 'mixed' })
  const [isScanning, setIsScanning] = useState(false)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isLegacyDiscovering, setIsLegacyDiscovering] = useState(false)
  const [isRestoring, setIsRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const slotAttemptsRef = useRef(new Map<string, Set<string>>())
  const scanAbortRef = useRef(new Map<string, AbortController>())
  const scaffoldGalleryBusyRef = useRef(false)
  const scaffoldLegacyBusyRef = useRef(false)
  const undisplayedByFolderRef = useRef(new Map<string, MediaFile[]>())
  const undisplayedLegacyByFolderRef = useRef(new Map<string, MediaFile[]>())
  const displayedIdsRef = useRef(new Set<string>())
  const displayedLegacyIdsRef = useRef(new Set<string>())
  const poolRef = useRef<MediaFile[]>([])
  const slotsRef = useRef<GallerySlot[]>([])
  const legacyPoolRef = useRef<MediaFile[]>([])
  const legacySlotsRef = useRef<GallerySlot[]>([])
  const galleryViewRef = useRef<GalleryView>({ mode: 'mixed' })
  const favoriteIdsRef = useRef(favoriteIds)
  const activeFoldersRef = useRef<ActiveFolder[]>([])
  // Mixed view phase 1: 2 representatives per directory. Phase 2
  // (pickContinuation) streams the rest of the pool afterwards.
  const overviewQuotaRef = useRef(new OverviewQuota())
  const legacyOverviewQuotaRef = useRef(new OverviewQuota())
  const preparedGalleryRef = useRef<MediaFile[]>([])
  const preparingGalleryRef = useRef<Promise<void> | null>(null)
  // Bumped whenever the grid is rebuilt so in-flight preparation is discarded.
  const galleryGenerationRef = useRef(0)
  const unplayableIdsRef = useRef(new Set<string>())
  const wantsMoreGalleryRef = useRef(false)
  const wantsMoreLegacyRef = useRef(false)

  const resetGalleryPipeline = useCallback(() => {
    galleryGenerationRef.current++
    preparedGalleryRef.current = []
    wantsMoreGalleryRef.current = false
  }, [])

  poolRef.current = mediaPool
  slotsRef.current = displaySlots
  legacyPoolRef.current = legacyPool
  legacySlotsRef.current = legacyDisplaySlots
  galleryViewRef.current = galleryView
  favoriteIdsRef.current = favoriteIds
  activeFoldersRef.current = activeFolders

  const mediaStats = useMemo(
    () => getMediaStats(resolveVisiblePool(mediaPool, galleryView, favoriteIds)),
    [mediaPool, galleryView, favoriteIds],
  )
  const displayItems = displaySlots

  const remixGallery = useCallback(
    (pool: MediaFile[], view: GalleryView = galleryViewRef.current) => {
      slotAttemptsRef.current.clear()
      resetGalleryPipeline()
      const visible = resolveVisiblePool(pool, view, favoriteIdsRef.current)
      const slots = mixDisplaySlots(
        view.mode === 'mixed'
          ? sampleOverview(visible, overviewQuotaRef.current)
          : visible,
      )
      slotsRef.current = slots
      setDisplaySlots(slots)
      displayedIdsRef.current = new Set(slots.map((slot) => slot.media.id))
      undisplayedByFolderRef.current.clear()
    },
    [resetGalleryPipeline],
  )

  const remixLegacyGallery = useCallback((pool: MediaFile[]) => {
    const slots = mixDisplaySlots(
      sampleOverview(pool, legacyOverviewQuotaRef.current),
    )
    legacySlotsRef.current = slots
    setLegacyDisplaySlots(slots)
    displayedLegacyIdsRef.current = new Set(slots.map((slot) => slot.media.id))
    undisplayedLegacyByFolderRef.current.clear()
  }, [])

  /**
   * Swaps an unplayable overview pick for another file from the same
   * directory, so a folder with one bad file still gets represented.
   */
  const refillOverviewSlot = useCallback((failed: MediaFile) => {
    const quota = overviewQuotaRef.current
    quota.release(failed)
    const dir = directoryKey(failed)
    const candidate = poolRef.current.find(
      (file) =>
        directoryKey(file) === dir &&
        !unplayableIdsRef.current.has(file.id) &&
        !displayedIdsRef.current.has(file.id) &&
        !quota.isAdmitted(file),
    )
    if (candidate && quota.admit(candidate)) {
      enqueueUndisplayed(undisplayedByFolderRef.current, candidate.folderId, [
        candidate,
      ])
    }
  }, [])

  /**
   * Validates and size-probes the next overview batch off-screen, so it can
   * be appended instantly when the user nears the bottom.
   */
  const prepareGalleryBatch = useCallback((): Promise<void> => {
    if (preparingGalleryRef.current) return preparingGalleryRef.current
    if (preparedGalleryRef.current.length >= SCAFFOLD_BATCH_SIZE) {
      return Promise.resolve()
    }

    const generation = galleryGenerationRef.current
    const work = (async () => {
      for (let attempt = 0; attempt < PREPARE_MAX_ATTEMPTS; attempt++) {
        const reserved = new Set(displayedIdsRef.current)
        for (const file of preparedGalleryRef.current) reserved.add(file.id)
        const needed = SCAFFOLD_BATCH_SIZE - preparedGalleryRef.current.length
        const candidates = pickRandomEqualMix(
          undisplayedByFolderRef.current,
          reserved,
          needed,
        )
        removeFromBuffer(undisplayedByFolderRef.current, candidates)

        // Overview picks first; once every known folder has had its 2,
        // keep the stream going with uncapped, folder-balanced picks.
        if (candidates.length < needed) {
          const excluded = new Set(reserved)
          for (const file of candidates) excluded.add(file.id)
          for (const id of unplayableIdsRef.current) excluded.add(id)
          candidates.push(
            ...pickContinuation(
              resolveVisiblePool(
                poolRef.current,
                galleryViewRef.current,
                favoriteIdsRef.current,
              ),
              excluded,
              countShownPerDirectory([
                ...slotsRef.current.map((slot) => slot.media),
                ...preparedGalleryRef.current,
                ...candidates,
              ]),
              needed - candidates.length,
            ),
          )
        }
        if (candidates.length === 0) return

        const { files: playable } = await filterPlayableMedia(candidates)
        if (generation !== galleryGenerationRef.current) return

        const playableIds = new Set(playable.map((file) => file.id))
        for (const file of candidates) {
          if (playableIds.has(file.id)) continue
          unplayableIdsRef.current.add(file.id)
          if (overviewQuotaRef.current.isAdmitted(file)) refillOverviewSlot(file)
        }

        await probeAspectRatios(playable)
        if (generation !== galleryGenerationRef.current) return
        preparedGalleryRef.current.push(...playable)
        if (preparedGalleryRef.current.length >= SCAFFOLD_BATCH_SIZE) return
      }
    })().finally(() => {
      preparingGalleryRef.current = null
    })

    preparingGalleryRef.current = work
    return work
  }, [refillOverviewSlot])

  const loadMoreGallery = useCallback(async () => {
    if (scaffoldGalleryBusyRef.current) return
    if (galleryViewRef.current.mode !== 'mixed') return

    scaffoldGalleryBusyRef.current = true
    try {
      if (preparedGalleryRef.current.length === 0) {
        await prepareGalleryBatch()
      }
      const batch = preparedGalleryRef.current
        .splice(0, SCAFFOLD_BATCH_SIZE)
        .filter((file) => !displayedIdsRef.current.has(file.id))
      if (batch.length === 0) {
        // Nothing ready yet: load as soon as the scan discovers more.
        wantsMoreGalleryRef.current = true
        return
      }
      wantsMoreGalleryRef.current = false

      for (const file of batch) {
        displayedIdsRef.current.add(file.id)
      }
      setDisplaySlots((prev) => {
        const next =
          prev.length === 0
            ? batch.map((media) => ({
                key: media.id,
                media,
                useFixedHeight: false,
              }))
            : appendDisplaySlots(prev, batch)
        slotsRef.current = next
        return next
      })
    } finally {
      scaffoldGalleryBusyRef.current = false
    }
    void prepareGalleryBatch()
  }, [prepareGalleryBatch])

  const loadMoreLegacy = useCallback(async () => {
    if (scaffoldLegacyBusyRef.current) return

    const batch = pickRandomEqualMix(
      undisplayedLegacyByFolderRef.current,
      displayedLegacyIdsRef.current,
      SCAFFOLD_BATCH_SIZE,
    )
    removeFromBuffer(undisplayedLegacyByFolderRef.current, batch)
    if (batch.length < SCAFFOLD_BATCH_SIZE) {
      const excluded = new Set(displayedLegacyIdsRef.current)
      for (const file of batch) excluded.add(file.id)
      batch.push(
        ...pickContinuation(
          legacyPoolRef.current,
          excluded,
          countShownPerDirectory([
            ...legacySlotsRef.current.map((slot) => slot.media),
            ...batch,
          ]),
          SCAFFOLD_BATCH_SIZE - batch.length,
        ),
      )
    }
    if (batch.length === 0) {
      wantsMoreLegacyRef.current = true
      return
    }
    wantsMoreLegacyRef.current = false

    scaffoldLegacyBusyRef.current = true
    try {
      await probeAspectRatios(batch)
      for (const file of batch) {
        displayedLegacyIdsRef.current.add(file.id)
      }
      setLegacyDisplaySlots((prev) => {
        const next =
          prev.length === 0
            ? batch.map((media) => ({
                key: media.id,
                media,
                useFixedHeight: false,
              }))
            : appendDisplaySlots(prev, batch)
        legacySlotsRef.current = next
        return next
      })
    } finally {
      scaffoldLegacyBusyRef.current = false
    }
  }, [])

  const enqueueGalleryDiscovery = useCallback(
    (folderId: string, files: MediaFile[]) => {
      const overview = overviewQuotaRef.current.filter(files)
      enqueueUndisplayed(undisplayedByFolderRef.current, folderId, overview)
      // Non-overview files still feed phase 2 via the pool, so a stalled
      // grid must resume even when no new representatives were found.
      if (slotsRef.current.length === 0 || wantsMoreGalleryRef.current) {
        void loadMoreGallery()
      } else {
        void prepareGalleryBatch()
      }
    },
    [loadMoreGallery, prepareGalleryBatch],
  )

  const enqueueLegacyDiscovery = useCallback(
    (folderId: string, files: MediaFile[]) => {
      const overview = legacyOverviewQuotaRef.current.filter(files)
      enqueueUndisplayed(undisplayedLegacyByFolderRef.current, folderId, overview)
      if (legacySlotsRef.current.length === 0 || wantsMoreLegacyRef.current) {
        void loadMoreLegacy()
      }
    },
    [loadMoreLegacy],
  )

  const reloadGrid = useCallback(
    (pool?: MediaFile[]) => {
      remixGallery(pool ?? poolRef.current, galleryViewRef.current)
    },
    [remixGallery],
  )

  const mergeLegacyPoolForFolder = useCallback(
    (folderId: string, folderFiles: MediaFile[]) => {
      return dedupeMediaFiles([
        ...filterByFolder(legacyPoolRef.current, folderId),
        ...folderFiles,
      ])
    },
    [],
  )

  const mergePoolForFolder = useCallback(
    (folderId: string, folderFiles: MediaFile[]) => {
      return dedupeMediaFiles([
        ...filterByFolder(poolRef.current, folderId),
        ...folderFiles,
      ])
    },
    [],
  )

  const showMixedGallery = useCallback(() => {
    setGalleryView({ mode: 'mixed' })
    remixGallery(poolRef.current, { mode: 'mixed' })
    scrollToTop()
  }, [remixGallery])

  const showFavoritesGallery = useCallback(() => {
    setGalleryView({ mode: 'favorites' })
    remixGallery(poolRef.current, { mode: 'favorites' })
    scrollToTop()
  }, [remixGallery])

  const filterToSubfolder = useCallback(
    (file: MediaFile) => {
      const directoryPath = file.relativePath.includes('/')
        ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/'))
        : ''
      const rootName =
        activeFoldersRef.current.find((folder) => folder.id === file.folderId)
          ?.name ?? 'Folder'
      const filter = {
        folderId: file.folderId,
        directoryPath,
        label: formatSubfolderLabel(directoryPath, rootName),
      }
      const view: GalleryView = { mode: 'subfolder', filter }
      setGalleryView(view)
      remixGallery(poolRef.current, view)
      scrollToTop()
    },
    [remixGallery],
  )

  const rootFolderName = useCallback((folderId: string) => {
    return (
      activeFoldersRef.current.find((folder) => folder.id === folderId)?.name ??
      'Folder'
    )
  }, [])

  useEffect(() => {
    if (galleryView.mode !== 'favorites') return
    remixGallery(poolRef.current, { mode: 'favorites' })
  }, [favoriteIds, galleryView.mode, remixGallery])

  const persistActiveFolders = useCallback((folders: ActiveFolder[]) => {
    setActiveFolderIds(folders.map((f) => f.id))
  }, [])

  const cancelFolderScan = useCallback((folderId: string) => {
    scanAbortRef.current.get(folderId)?.abort()
    scanAbortRef.current.delete(folderId)
  }, [])

  const updateFolderCounts = useCallback(
    (folderId: string, files: MediaFile[]) => {
      const { images, videos } = countByKind(files)
      setActiveFolders((prev) =>
        prev.map((folder) =>
          folder.id === folderId
            ? {
                ...folder,
                fileCount: files.length,
                imageCount: images,
                videoCount: videos,
              }
            : folder,
        ),
      )
      return { images, videos, total: files.length }
    },
    [],
  )

  const persistFolder = useCallback(
    async (
      folderId: string,
      handle: FileSystemDirectoryHandle,
      name: string,
      files: MediaFile[],
      addedAt: number,
    ) => {
      const { images, videos } = countByKind(files)
      await saveFolder({
        id: folderId,
        name,
        handle,
        addedAt,
        lastUsedAt: Date.now(),
        fileCount: files.length,
        imageCount: images,
        videoCount: videos,
      })
    },
    [],
  )

  const runBackgroundDualScan = useCallback(
    async (
      handle: FileSystemDirectoryHandle,
      folderId: string,
      galleryInitial: MediaFile[],
      legacyInitial: MediaFile[],
      gallerySkip: { overLimit: number; unplayable: number },
    ) => {
      const controller = new AbortController()
      scanAbortRef.current.set(folderId, controller)
      setIsDiscovering(true)
      if (legacyInitial.length > 0) setIsLegacyDiscovering(true)

      const gallerySeen = new Set(galleryInitial.map((file) => file.id))
      const legacySeen = new Set(legacyInitial.map((file) => file.id))
      const galleryFolderFiles = new Map(
        galleryInitial.map((file) => [file.id, file]),
      )
      const legacyFolderFiles = new Map(
        legacyInitial.map((file) => [file.id, file]),
      )
      let galleryTotals = { ...gallerySkip }

      try {
        await backgroundDualScanFolder(
          handle,
          folderId,
          gallerySeen,
          legacySeen,
          {
            onGalleryBackground: async (batch) => {
              galleryTotals = mergeSkipTotals(galleryTotals, batch)
              for (const file of batch.files) {
                galleryFolderFiles.set(file.id, file)
              }
              const folderFileList = [...galleryFolderFiles.values()]
              const nextPool = mergePoolForFolder(folderId, folderFileList)
              poolRef.current = nextPool
              setMediaPool(nextPool)
              updateFolderCounts(folderId, folderFileList)
              if (
                galleryViewRef.current.mode === 'mixed' &&
                batch.files.length > 0
              ) {
                enqueueGalleryDiscovery(folderId, batch.files)
              }
            },
            onLegacyBackground: async (batch) => {
              for (const file of batch.files) {
                legacyFolderFiles.set(file.id, file)
              }
              const nextLegacy = mergeLegacyPoolForFolder(
                folderId,
                [...legacyFolderFiles.values()],
              )
              legacyPoolRef.current = nextLegacy
              setLegacyPool(nextLegacy)
              if (batch.files.length > 0) {
                enqueueLegacyDiscovery(folderId, batch.files)
              }
            },
          },
          controller.signal,
        )

        const allGalleryFiles = [...galleryFolderFiles.values()]
        updateFolderCounts(folderId, allGalleryFiles)

        const stored = await getFolder(folderId)
        await persistFolder(
          folderId,
          handle,
          handle.name,
          allGalleryFiles,
          stored?.addedAt ?? Date.now(),
        )

        const skipNotice = formatScanSkipNotice(
          galleryTotals.overLimit,
          galleryTotals.unplayable,
        )
        if (skipNotice) setNotice(skipNotice)
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Background scan failed')
        }
      } finally {
        scanAbortRef.current.delete(folderId)
        if (scanAbortRef.current.size === 0) {
          setIsDiscovering(false)
          setIsLegacyDiscovering(false)
        }
      }
    },
    [
      persistFolder,
      updateFolderCounts,
      mergePoolForFolder,
      mergeLegacyPoolForFolder,
      enqueueGalleryDiscovery,
      enqueueLegacyDiscovery,
    ],
  )

  const ingestFolder = useCallback(
    async (
      handle: FileSystemDirectoryHandle,
      existingId?: string,
      displayName?: string,
    ): Promise<ActiveFolder | null> => {
      const folderId = existingId ?? crypto.randomUUID()
      const now = Date.now()

      const granted = await ensureReadPermission(handle)
      if (!granted) {
        setError('Folder permission was denied')
        return null
      }

      cancelFolderScan(folderId)

      const existing = existingId ? await getFolder(folderId) : undefined
      const galleryFolderFiles = new Map<string, MediaFile>()
      const legacyFolderFiles = new Map<string, MediaFile>()
      let skipTotals = { overLimit: 0, unplayable: 0 }

      const folder: ActiveFolder = {
        id: folderId,
        name: displayName ?? handle.name,
        handle,
        fileCount: 0,
        imageCount: 0,
        videoCount: 0,
        addedAt: existing?.addedAt ?? now,
      }

      setActiveFolders((prev) => [folder, ...prev.filter((f) => f.id !== folderId)])

      const controller = new AbortController()
      scanAbortRef.current.set(folderId, controller)

      const applyGalleryQuick = async (batch: ScanResult) => {
        skipTotals = mergeSkipTotals(skipTotals, batch)
        for (const file of batch.files) {
          galleryFolderFiles.set(file.id, file)
        }

        const quickFiles = [...galleryFolderFiles.values()]
        const nextPool = mergePoolForFolder(folderId, quickFiles)
        poolRef.current = nextPool
        setMediaPool(nextPool)
        enqueueGalleryDiscovery(folderId, batch.files)
        updateFolderCounts(folderId, quickFiles)
        setIsScanning(false)
        setIsRestoring(false)
        setIsDiscovering(true)
      }

      const applyLegacyQuick = async (batch: ScanResult) => {
        for (const file of batch.files) {
          legacyFolderFiles.set(file.id, file)
        }
        const nextLegacy = mergeLegacyPoolForFolder(
          folderId,
          [...legacyFolderFiles.values()],
        )
        legacyPoolRef.current = nextLegacy
        setLegacyPool(nextLegacy)
        enqueueLegacyDiscovery(folderId, batch.files)
        if (batch.files.length > 0) setIsLegacyDiscovering(true)
      }

      try {
        const totals = await progressiveDualScanFolder(handle, folderId, {
          signal: controller.signal,
          onGalleryQuick: applyGalleryQuick,
          onLegacyQuick: applyLegacyQuick,
          onGalleryBackground: async (batch) => {
            skipTotals = mergeSkipTotals(skipTotals, batch)
            for (const file of batch.files) {
              galleryFolderFiles.set(file.id, file)
            }

            const nextPool = mergePoolForFolder(
              folderId,
              [...galleryFolderFiles.values()],
            )
            poolRef.current = nextPool
            setMediaPool(nextPool)
            updateFolderCounts(folderId, [...galleryFolderFiles.values()])
            if (
              galleryViewRef.current.mode === 'mixed' &&
              batch.files.length > 0
            ) {
              enqueueGalleryDiscovery(folderId, batch.files)
            }
          },
          onLegacyBackground: async (batch) => {
            for (const file of batch.files) {
              legacyFolderFiles.set(file.id, file)
            }
            const nextLegacy = mergeLegacyPoolForFolder(
              folderId,
              [...legacyFolderFiles.values()],
            )
            legacyPoolRef.current = nextLegacy
            setLegacyPool(nextLegacy)
            if (batch.files.length > 0) {
              enqueueLegacyDiscovery(folderId, batch.files)
            }
          },
        })

        skipTotals = {
          overLimit: totals.gallery.skippedOverLimit,
          unplayable: totals.gallery.skippedUnplayable,
        }

        const allFolderFiles = [...galleryFolderFiles.values()]
        await touchFolder(folderId)
        await persistFolder(
          folderId,
          handle,
          handle.name,
          allFolderFiles,
          existing?.addedAt ?? now,
        )

        const skipNotice = formatScanSkipNotice(
          skipTotals.overLimit,
          skipTotals.unplayable,
        )
        if (skipNotice) setNotice(skipNotice)

        const kinds = countByKind(allFolderFiles)
        return {
          ...folder,
          fileCount: allFolderFiles.length,
          imageCount: kinds.images,
          videoCount: kinds.videos,
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null
        }
        setError(err instanceof Error ? err.message : 'Failed to scan folder')
        return null
      } finally {
        scanAbortRef.current.delete(folderId)
        if (scanAbortRef.current.size === 0) {
          setIsDiscovering(false)
          setIsLegacyDiscovering(false)
        }
        setIsScanning(false)
      }
    },
    [
      cancelFolderScan,
      persistFolder,
      updateFolderCounts,
      mergePoolForFolder,
      mergeLegacyPoolForFolder,
      enqueueGalleryDiscovery,
      enqueueLegacyDiscovery,
    ],
  )

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const ids = getActiveFolderIds()
      if (ids.length === 0) {
        setIsRestoring(false)
        return
      }

      setIsRestoring(true)
      const loadedFolders: ActiveFolder[] = []
      let allFiles: MediaFile[] = []
      let allLegacyFiles: MediaFile[] = []
      let skipTotals = { overLimit: 0, unplayable: 0 }
      let quickShown = false

      // queryReadPermission never throws — requestPermission() would throw a
      // SecurityError here (no user gesture on page load), which previously
      // rejected this whole Promise.all and left the app stuck forever on
      // "Restoring folders…" (i.e. a permanently blank grid).
      const quickResults = await Promise.all(
        ids.map(async (id) => {
          const stored = await getFolder(id)
          if (!stored) return null

          const granted = await queryReadPermission(stored.handle)
          if (!granted) return { stored, quick: null }

          try {
            const quick = await quickDualScanFolder(stored.handle, id)
            return { stored, quick }
          } catch {
            return { stored, quick: null }
          }
        }),
      )

      if (cancelled) return

      for (const result of quickResults) {
        if (!result) continue
        const { stored, quick } = result

        if (!quick) {
          // Permission lapsed or scan failed — keep the folder visible with
          // a reconnect affordance instead of silently dropping it.
          loadedFolders.push({
            id: stored.id,
            name: stored.name,
            handle: stored.handle,
            fileCount: stored.fileCount,
            imageCount: stored.imageCount,
            videoCount: stored.videoCount,
            addedAt: stored.addedAt,
            needsPermission: true,
          })
          continue
        }

        skipTotals = mergeSkipTotals(skipTotals, quick.gallery)
        allFiles = dedupeMediaFiles([...allFiles, ...quick.gallery.files])
        allLegacyFiles = dedupeMediaFiles([
          ...allLegacyFiles,
          ...quick.legacy.files,
        ])

        const { images, videos } = countByKind(quick.gallery.files)
        loadedFolders.push({
          id: stored.id,
          name: stored.name,
          handle: stored.handle,
          fileCount: quick.gallery.files.length,
          imageCount: images,
          videoCount: videos,
          addedAt: stored.addedAt,
        })
      }

      if (loadedFolders.length > 0) {
        loadedFolders.sort((a, b) => b.addedAt - a.addedAt)
        setActiveFolders(loadedFolders)
        poolRef.current = allFiles
        setMediaPool(allFiles)
        legacyPoolRef.current = allLegacyFiles
        setLegacyPool(allLegacyFiles)
        setGalleryView({ mode: 'mixed' })
        persistActiveFolders(loadedFolders)
        quickShown = true
        if (allLegacyFiles.length > 0) setIsLegacyDiscovering(true)

        undisplayedByFolderRef.current.clear()
        undisplayedLegacyByFolderRef.current.clear()
        displayedIdsRef.current.clear()
        displayedLegacyIdsRef.current.clear()
        overviewQuotaRef.current.reset()
        legacyOverviewQuotaRef.current.reset()
        resetGalleryPipeline()
        slotsRef.current = []
        legacySlotsRef.current = []
        setDisplaySlots([])
        setLegacyDisplaySlots([])

        for (const result of quickResults) {
          if (!result?.quick) continue
          enqueueUndisplayed(
            undisplayedByFolderRef.current,
            result.stored.id,
            overviewQuotaRef.current.filter(result.quick.gallery.files),
          )
          enqueueUndisplayed(
            undisplayedLegacyByFolderRef.current,
            result.stored.id,
            legacyOverviewQuotaRef.current.filter(result.quick.legacy.files),
          )
        }

        await loadMoreGallery()
        await loadMoreLegacy()
      } else {
        setActiveFolderIds([])
      }

      setIsRestoring(false)

      if (skipTotals.overLimit > 0 || skipTotals.unplayable > 0) {
        const skipNotice = formatScanSkipNotice(
          skipTotals.overLimit,
          skipTotals.unplayable,
        )
        if (skipNotice) setNotice(skipNotice)
      }

      if (!quickShown || cancelled) return

      for (const result of quickResults) {
        if (cancelled || !result || !result.quick) continue
        const { stored, quick } = result
        void runBackgroundDualScan(
          stored.handle,
          stored.id,
          quick.gallery.files,
          quick.legacy.files,
          {
            overLimit: quick.gallery.skippedOverLimit,
            unplayable: quick.gallery.skippedUnplayable,
          },
        )
      }
    }

    void restore()
    return () => {
      cancelled = true
      for (const controller of scanAbortRef.current.values()) {
        controller.abort()
      }
      scanAbortRef.current.clear()
    }
  }, [
    persistActiveFolders,
    runBackgroundDualScan,
    loadMoreGallery,
    loadMoreLegacy,
    resetGalleryPipeline,
  ])

  useEffect(() => {
    // Until restore finishes, activeFolders is still the empty initial state;
    // persisting it would wipe the saved list before (a re-run of) restore reads it.
    if (isRestoring) return
    persistActiveFolders(activeFolders)
  }, [activeFolders, isRestoring, persistActiveFolders])

  const addFolder = useCallback(async () => {
    setError(null)
    setNotice(null)
    setIsScanning(true)
    try {
      const handle = await pickDirectory()
      await ingestFolder(handle)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to add folder')
    } finally {
      setIsScanning(false)
    }
  }, [ingestFolder])

  const addHandle = useCallback(
    async (handle: FileSystemDirectoryHandle, displayName?: string) => {
      setError(null)
      setNotice(null)
      setIsScanning(true)
      try {
        await ingestFolder(handle, undefined, displayName)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to add folder')
      } finally {
        setIsScanning(false)
      }
    },
    [ingestFolder],
  )

  const reconnectFolder = useCallback(
    async (folderId: string) => {
      setError(null)
      setIsScanning(true)
      try {
        const stored = await getFolder(folderId)
        if (!stored) {
          setError('Folder not found in history')
          return false
        }

        // Called from a click handler, so this has real user activation and
        // requestPermission() can succeed instead of throwing.
        const granted = await ensureReadPermission(stored.handle)
        if (!granted) {
          setError('Permission was not granted for this folder')
          return false
        }

        await ingestFolder(stored.handle, folderId)
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reconnect folder')
        return false
      } finally {
        setIsScanning(false)
      }
    },
    [ingestFolder],
  )

  const loadFolderFromHistory = useCallback(
    async (folderId: string) => {
      setError(null)
      setIsScanning(true)
      try {
        if (activeFolders.some((f) => f.id === folderId)) {
          setIsScanning(false)
          return true
        }

        const stored = await getFolder(folderId)
        if (!stored) {
          setError('Folder not found in history')
          return false
        }

        await ingestFolder(stored.handle, folderId)
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load folder')
        return false
      } finally {
        setIsScanning(false)
      }
    },
    [activeFolders, ingestFolder],
  )

  const removeFolder = useCallback(
    (folderId: string) => {
      cancelFolderScan(folderId)
      undisplayedByFolderRef.current.delete(folderId)
      undisplayedLegacyByFolderRef.current.delete(folderId)
      setActiveFolders((prev) => prev.filter((f) => f.id !== folderId))
      setGalleryView((prev) =>
        prev.mode === 'subfolder' && prev.filter.folderId === folderId
          ? { mode: 'mixed' }
          : prev,
      )
      setMediaPool((prev) => {
        const next = filterByFolder(prev, folderId)
        poolRef.current = next
        remixGallery(next, { mode: 'mixed' })
        return next
      })
      setLegacyPool((prev) => {
        const next = filterByFolder(prev, folderId)
        legacyPoolRef.current = next
        remixLegacyGallery(next)
        return next
      })
    },
    [cancelFolderScan, remixGallery, remixLegacyGallery],
  )

  const clearAllFolders = useCallback(() => {
    // Cancel all ongoing scans
    for (const controller of scanAbortRef.current.values()) {
      controller.abort()
    }
    scanAbortRef.current.clear()
    
    // Clear all state
    setActiveFolders([])
    setMediaPool([])
    setLegacyPool([])
    setDisplaySlots([])
    setLegacyDisplaySlots([])
    setGalleryView({ mode: 'mixed' })
    
    // Clear refs
    undisplayedByFolderRef.current.clear()
    undisplayedLegacyByFolderRef.current.clear()
    displayedIdsRef.current.clear()
    displayedLegacyIdsRef.current.clear()
    overviewQuotaRef.current.reset()
    legacyOverviewQuotaRef.current.reset()
    resetGalleryPipeline()
    wantsMoreLegacyRef.current = false
    poolRef.current = []
    slotsRef.current = []
    legacyPoolRef.current = []
    legacySlotsRef.current = []
    
    setIsScanning(false)
    setIsDiscovering(false)
    setIsLegacyDiscovering(false)
  }, [resetGalleryPipeline])

  const refresh = useCallback(() => {
    reloadGrid(mediaPool)
  }, [mediaPool, reloadGrid])

  const refreshLegacy = useCallback(() => {
    remixLegacyGallery(legacyPool)
  }, [legacyPool, remixLegacyGallery])

  const reportSlotFailed = useCallback(
    (slotKey: string, kind: MediaKind) => {
      setDisplaySlots((prev) => {
        const idx = prev.findIndex((slot) => slot.key === slotKey)
        if (idx === -1) return prev

        const current = prev[idx]
        const tried =
          slotAttemptsRef.current.get(slotKey) ?? new Set<string>()
        tried.add(current.media.id)

        const onScreenIds = new Set(prev.map((slot) => slot.media.id))
        const visiblePool = resolveVisiblePool(
          poolRef.current,
          galleryViewRef.current,
          favoriteIdsRef.current,
        )
        const replacement =
          galleryViewRef.current.mode === 'mixed'
            ? pickOverviewReplacement(visiblePool, prev, current.media, tried, kind)
            : pickSlotReplacement(visiblePool, onScreenIds, tried, kind)

        if (!replacement) {
          return prev
        }

        tried.add(replacement.id)
        slotAttemptsRef.current.set(slotKey, tried)

        const next = [...prev]
        next[idx] = {
          key: slotKey,
          media: replacement,
          useFixedHeight: true,
        }
        slotsRef.current = next
        return next
      })
    },
    [],
  )

  const reportLegacySlotFailed = useCallback(
    (slotKey: string, kind: MediaKind) => {
      setLegacyDisplaySlots((prev) => {
        const idx = prev.findIndex((slot) => slot.key === slotKey)
        if (idx === -1) return prev

        const current = prev[idx]
        const tried =
          slotAttemptsRef.current.get(slotKey) ?? new Set<string>()
        tried.add(current.media.id)

        const replacement = pickOverviewReplacement(
          legacyPoolRef.current,
          prev,
          current.media,
          tried,
          kind,
        )

        if (!replacement) {
          return prev
        }

        tried.add(replacement.id)
        slotAttemptsRef.current.set(slotKey, tried)

        const next = [...prev]
        next[idx] = {
          key: slotKey,
          media: replacement,
          useFixedHeight: true,
        }
        legacySlotsRef.current = next
        return next
      })
    },
    [],
  )

  return {
    activeFolders,
    mediaPool,
    legacyPool,
    displayItems,
    legacyDisplayItems: legacyDisplaySlots,
    legacyCount: legacyPool.length,
    displaySlots,
    galleryView,
    mediaStats,
    isScanning,
    isDiscovering,
    isLegacyDiscovering,
    isRestoring,
    error,
    notice,
    addFolder,
    addHandle,
    removeFolder,
    clearAllFolders,
    loadFolderFromHistory,
    reconnectFolder,
    loadMoreGallery,
    loadMoreLegacy,
    refresh,
    refreshLegacy,
    reportSlotFailed,
    reportLegacySlotFailed,
    showMixedGallery,
    showFavoritesGallery,
    filterToSubfolder,
    rootFolderName,
    clearError: () => setError(null),
    clearNotice: () => setNotice(null),
  }
}
