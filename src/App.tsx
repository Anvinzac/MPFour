import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Header } from './components/Header'
import { FolderChips } from './components/FolderChips'
import { EmptyState } from './components/EmptyState'
import { HistoryPage } from './components/HistoryPage'
import { LegacyVideoPage } from './components/LegacyVideoPage'
import { MasonryGrid } from './components/MasonryGrid'
import { GalleryFilterBar } from './components/GalleryFilterBar'
import { FileTreeExplorer } from './components/FileTreeExplorer'
import { MemoryChip } from './components/MemoryChip'
import { PaneResizeHandle } from './components/PaneResizeHandle'
import { VideoPlaylistPane } from './components/VideoPlaylistPane'
import { useCanvasPlayerCount } from './hooks/useCanvasPlayerCount'
import { FullScreenProvider } from './hooks/useFullScreen'
import { FavoritesProvider, useFavorites } from './hooks/useFavorites'
import { GalleryActionsProvider } from './hooks/useGalleryActions'
import { resolveVisiblePool, useMediaPool } from './hooks/useMediaPool'
import { usePaneWidth } from './hooks/usePaneWidth'
import { isDirectoryPickerSupported } from './lib/fileScanner'
import { isImagesOnly, setImagesOnly } from './lib/scanPreferences'
import type { AppView, GalleryView, PickerStartIn } from './types'

const directoryPickerSupported = isDirectoryPickerSupported()

function galleryViewKey(view: GalleryView): string {
  if (view.mode !== 'subfolder') return view.mode
  return `subfolder:${view.filter.folderId}:${view.filter.directoryPath}`
}

function AppContent() {
  const [view, setView] = useState<AppView>('grid')
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [explorerPreset, setExplorerPreset] = useState<PickerStartIn | undefined>(
    undefined,
  )
  const { favoriteIds, error: favoritesError, clearError: clearFavoritesError } = useFavorites()
  const {
    activeFolders,
    mediaPool,
    displayItems,
    legacyDisplayItems,
    legacyCount,
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
    clearError,
    clearNotice,
  } = useMediaPool(favoriteIds)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(clearNotice, 5000)
    return () => window.clearTimeout(timer)
  }, [notice, clearNotice])

  useEffect(() => {
    if (!favoritesError) return
    const timer = window.setTimeout(clearFavoritesError, 5000)
    return () => window.clearTimeout(timer)
  }, [favoritesError, clearFavoritesError])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(clearError, 5000)
    return () => window.clearTimeout(timer)
  }, [error, clearError])

  const playingCount = useCanvasPlayerCount()
  const busy = isScanning || isRestoring

  // Dual pane: videos play one after another in the docked left player, and
  // the gallery on the right shows only the photos of the same view.
  const showVideoPane = !isImagesOnly()
  const [paneWidth, setPaneWidth] = usePaneWidth()
  const photoSlots = useMemo(
    () =>
      showVideoPane
        ? displayItems.filter((slot) => slot.media.kind === 'image')
        : displayItems,
    [displayItems, showVideoPane],
  )
  const paneVideos = useMemo(
    () =>
      showVideoPane
        ? resolveVisiblePool(mediaPool, galleryView, favoriteIds).filter(
            (file) => file.kind === 'video',
          )
        : [],
    [showVideoPane, mediaPool, galleryView, favoriteIds],
  )

  const galleryActions = {
    galleryView,
    filterToSubfolder: (file: Parameters<typeof filterToSubfolder>[0]) => {
      filterToSubfolder(file)
      setView('grid')
    },
    showMixedGallery: () => {
      showMixedGallery()
      setView('grid')
    },
    showFavoritesGallery: () => {
      showFavoritesGallery()
      setView('grid')
    },
    rootFolderName,
  }

  if (view === 'legacy') {
    return (
      <>
        <LegacyVideoPage
          legacyItems={legacyDisplayItems}
          legacyCount={legacyCount}
          isDiscovering={isLegacyDiscovering}
          isScanning={busy}
          onBack={() => setView('grid')}
          onRefresh={refreshLegacy}
          reportSlotFailed={reportLegacySlotFailed}
          filterToSubfolder={(file) => {
            filterToSubfolder(file)
            setView('grid')
          }}
          showMixedGallery={() => {
            showMixedGallery()
            setView('grid')
          }}
          showFavoritesGallery={() => {
            showFavoritesGallery()
            setView('grid')
          }}
          rootFolderName={rootFolderName}
          galleryView={galleryView}
          onNearEnd={() => void loadMoreLegacy()}
        />
        <FileTreeExplorer
          open={explorerOpen}
          initialPreset={explorerPreset}
          onClose={() => setExplorerOpen(false)}
          onPick={async (handle, name) => {
            await addHandle(handle, name)
          }}
        />
      </>
    )
  }

  if (view === 'history') {
    return (
      <>
        <div className="min-h-screen bg-neutral-950 text-white">
          <div className="sticky top-0 z-50">
            <Header
              onAddFolder={() => {
                setView('grid')
                void addFolder()
              }}
              onBrowse={() => {
                setView('grid')
                setExplorerPreset(undefined)
                setExplorerOpen(true)
              }}
              onRefresh={refresh}
              onOpenHistory={() => setView('history')}
              onOpenLegacy={() => setView('legacy')}
              legacyCount={legacyCount}
              playingCount={playingCount}
              mediaStats={mediaStats}
              isScanning={busy}
              isDiscovering={isDiscovering}
              hasMedia={displayItems.length > 0}
            />
          </div>
          <HistoryPage
            activeFolderIds={activeFolders.map((f) => f.id)}
            onBack={() => setView('grid')}
            onLoadFolder={loadFolderFromHistory}
            onRemoveActive={removeFolder}
            isLoading={isScanning}
          />
        </div>
        <FileTreeExplorer
          open={explorerOpen}
          initialPreset={explorerPreset}
          onClose={() => setExplorerOpen(false)}
          onPick={async (handle, name) => {
            await addHandle(handle, name)
          }}
        />
      </>
    )
  }

  return (
    <GalleryActionsProvider value={galleryActions}>
      <div
        className="min-h-screen bg-neutral-950 text-white"
        style={{ '--pane-w': showVideoPane ? `${paneWidth}vw` : '0px' } as CSSProperties}
      >
        {showVideoPane && (
          <aside className="fixed inset-y-0 left-0 z-40 w-(--pane-w)">
            <VideoPlaylistPane
              videos={paneVideos}
              resetKey={galleryViewKey(galleryView)}
              isDiscovering={isDiscovering || busy}
            />
            <PaneResizeHandle width={paneWidth} onResize={setPaneWidth} />
          </aside>
        )}
        <div className="ml-(--pane-w)">
          <div className="sticky top-0 z-50">
            <Header
              onAddFolder={addFolder}
              onBrowse={() => {
                setExplorerPreset(undefined)
                setExplorerOpen(true)
              }}
              onRefresh={refresh}
              onClearAll={clearAllFolders}
              onOpenHistory={() => setView('history')}
              onOpenLegacy={() => setView('legacy')}
              legacyCount={legacyCount}
              playingCount={playingCount}
              mediaStats={mediaStats}
              isScanning={busy}
              isDiscovering={isDiscovering}
              hasMedia={displayItems.length > 0}
            />

            <FolderChips
              folders={activeFolders}
              onRemove={removeFolder}
              onReconnect={(folderId) => void reconnectFolder(folderId)}
              disabled={busy}
            />
          </div>

          <GalleryFilterBar
            galleryView={galleryView}
            onShowMixed={showMixedGallery}
            onShowFavorites={showFavoritesGallery}
            favoriteCount={favoriteIds.size}
            imagesOnly={isImagesOnly()}
            onToggleImagesOnly={() => {
              setImagesOnly(!isImagesOnly())
              window.location.reload()
            }}
          />

          {notice && (
            <div className="pointer-events-none fixed left-(--pane-w) right-0 top-28 z-[45] px-4">
              <div className="pointer-events-auto mx-auto flex max-w-7xl items-center justify-between rounded-lg border border-amber-900/50 bg-amber-950/95 px-4 py-2 text-sm text-amber-200 shadow-lg backdrop-blur-sm">
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={clearNotice}
                  className="ml-4 shrink-0 text-amber-300 hover:text-amber-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {(error || favoritesError) && (
            <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-red-900/50 bg-red-950/50 px-4 py-2 text-sm text-red-300">
              <span>{error ?? favoritesError}</span>
              <button
                type="button"
                onClick={() => {
                  clearError()
                  clearFavoritesError()
                }}
                className="ml-4 text-red-400 hover:text-red-200"
              >
                Dismiss
              </button>
            </div>
          )}

          {!directoryPickerSupported && (
            <div className="mx-4 mt-3 flex items-start rounded-lg border border-red-900/50 bg-red-950/50 px-4 py-2 text-sm text-red-300">
              <span>
                This browser can&apos;t open folders — the File System Access
                API is unavailable
                {!window.isSecureContext
                  ? ' because the page is not a secure context (use https:// or http://localhost).'
                  : '. Safari and Firefox don\'t support it; open MPFour in a Chromium-based browser such as Chrome or Edge.'}
              </span>
            </div>
          )}

          {isRestoring ? (
            <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
              Restoring folders…
            </div>
          ) : displayItems.length > 0 ? (
            <>
              {photoSlots.length === 0 && !isDiscovering && (
                <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
                  No photos in this view — its videos are playing on the left.
                </div>
              )}
              <MasonryGrid
                slots={photoSlots}
                loadProgress={displayItems.length}
                onSlotFailed={reportSlotFailed}
                onNearEnd={() => void loadMoreGallery()}
                footerStatus={
                  isDiscovering && galleryView.mode === 'mixed'
                    ? 'Scanning more folders…'
                    : null
                }
              />
            </>
          ) : isScanning ? (
            <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
              Opening folder…
            </div>
          ) : galleryView.mode === 'favorites' ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-neutral-500">
              <p>No favorites yet.</p>
              <p className="text-xs text-neutral-600">
                Tap the star on any item while the favorites server is running.
              </p>
            </div>
          ) : mediaPool.length === 0 ? (
            <EmptyState
              onOpenHistory={() => setView('history')}
              onBrowse={() => {
                setExplorerPreset(undefined)
                setExplorerOpen(true)
              }}
            />
          ) : (
            <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
              No files in this folder.
            </div>
          )}

          <FileTreeExplorer
            open={explorerOpen}
            initialPreset={explorerPreset}
            onClose={() => setExplorerOpen(false)}
            onPick={async (handle, name) => {
              await addHandle(handle, name)
            }}
          />
        </div>
        <MemoryChip />
      </div>
    </GalleryActionsProvider>
  )
}

function AppCrashFallback(error: Error, reset: () => void) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center text-white">
      <p className="text-lg font-medium">Something went wrong rendering the gallery.</p>
      <p className="max-w-md text-sm text-neutral-500">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200"
      >
        Try again
      </button>
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary fallback={AppCrashFallback}>
      <FavoritesProvider>
        <FullScreenProvider>
          <AppContent />
        </FullScreenProvider>
      </FavoritesProvider>
    </ErrorBoundary>
  )
}

export default App
