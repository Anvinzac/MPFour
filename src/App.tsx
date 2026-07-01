import { useState } from 'react'
import { Header } from './components/Header'
import { FolderChips } from './components/FolderChips'
import { EmptyState } from './components/EmptyState'
import { HistoryPage } from './components/HistoryPage'
import { LegacyVideoPage } from './components/LegacyVideoPage'
import { MasonryGrid } from './components/MasonryGrid'
import { GalleryFilterBar } from './components/GalleryFilterBar'
import { useCanvasPlayerCount } from './hooks/useCanvasPlayerCount'
import { FullScreenProvider } from './hooks/useFullScreen'
import { FavoritesProvider, useFavorites } from './hooks/useFavorites'
import { GalleryActionsProvider } from './hooks/useGalleryActions'
import { useMediaPool } from './hooks/useMediaPool'
import type { AppView } from './types'

function AppContent() {
  const [view, setView] = useState<AppView>('grid')
  const { favoriteIds, error: favoritesError } = useFavorites()
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
    removeFolder,
    loadFolderFromHistory,
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

  const playingCount = useCanvasPlayerCount()
  const busy = isScanning || isRestoring

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
      />
    )
  }

  if (view === 'history') {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <Header
          onAddFolder={() => {
            setView('grid')
            void addFolder()
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
        <HistoryPage
          activeFolderIds={activeFolders.map((f) => f.id)}
          onBack={() => setView('grid')}
          onLoadFolder={loadFolderFromHistory}
          onRemoveActive={removeFolder}
          isLoading={isScanning}
        />
      </div>
    )
  }

  return (
    <GalleryActionsProvider value={galleryActions}>
      <div className="min-h-screen bg-neutral-950 text-white">
        <Header
          onAddFolder={addFolder}
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

        <FolderChips
          folders={activeFolders}
          onRemove={removeFolder}
          disabled={busy}
        />

        <GalleryFilterBar
          galleryView={galleryView}
          onShowMixed={showMixedGallery}
          onShowFavorites={showFavoritesGallery}
          favoriteCount={favoriteIds.size}
        />

        {notice && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-amber-900/50 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
            <span>{notice}</span>
            <button
              type="button"
              onClick={clearNotice}
              className="ml-4 text-amber-300 hover:text-amber-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {(error || favoritesError) && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-red-900/50 bg-red-950/50 px-4 py-2 text-sm text-red-300">
            <span>{error ?? favoritesError}</span>
            <button
              type="button"
              onClick={clearError}
              className="ml-4 text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {isRestoring ? (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
            Restoring folders…
          </div>
        ) : displayItems.length > 0 ? (
          <MasonryGrid slots={displayItems} onSlotFailed={reportSlotFailed} />
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
          <EmptyState onOpenHistory={() => setView('history')} />
        ) : (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
            No files in this folder.
          </div>
        )}
      </div>
    </GalleryActionsProvider>
  )
}

function App() {
  return (
    <FavoritesProvider>
      <FullScreenProvider>
        <AppContent />
      </FullScreenProvider>
    </FavoritesProvider>
  )
}

export default App
