import { useCallback, useEffect, useState } from 'react'
import {
  deleteFolderFromHistory,
  listFolders,
  touchFolder,
} from '../lib/folderStore'
import type { StoredFolder } from '../types'

interface HistoryPageProps {
  activeFolderIds: string[]
  onBack: () => void
  onLoadFolder: (folderId: string) => Promise<boolean>
  onRemoveActive: (folderId: string) => void
  isLoading: boolean
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatFolderCounts(folder: StoredFolder): string {
  const images = folder.imageCount ?? 0
  const videos = folder.videoCount ?? 0
  if (images > 0 && videos > 0) {
    return `${images} photos, ${videos} videos`
  }
  return `${folder.fileCount} files`
}

export function HistoryPage({
  activeFolderIds,
  onBack,
  onLoadFolder,
  onRemoveActive,
  isLoading,
}: HistoryPageProps) {
  const [folders, setFolders] = useState<StoredFolder[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const refreshList = useCallback(async () => {
    setLoadingList(true)
    try {
      setFolders(await listFolders())
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const handleLoad = async (folderId: string) => {
    const ok = await onLoadFolder(folderId)
    if (ok) {
      await touchFolder(folderId)
      onBack()
    }
  }

  const handleDelete = async (folderId: string) => {
    if (activeFolderIds.includes(folderId)) {
      onRemoveActive(folderId)
    }
    await deleteFolderFromHistory(folderId)
    await refreshList()
  }

  return (
    <div className="min-h-[calc(100vh-57px)] px-4 py-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-neutral-100">History</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Previously added folders are saved here. Tap to load without picking
              again.
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
          >
            Back
          </button>
        </div>

        {loadingList ? (
          <p className="text-sm text-neutral-500">Loading history…</p>
        ) : folders.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center">
            <p className="text-sm text-neutral-400">
              No folders saved yet. Add a folder from the main screen — it will
              appear here for quick access later.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {folders.map((folder) => {
              const isActive = activeFolderIds.includes(folder.id)
              return (
                <li
                  key={folder.id}
                  className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3"
                >
                  <button
                    type="button"
                    disabled={isLoading || isActive}
                    onClick={() => void handleLoad(folder.id)}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <p className="truncate font-medium text-neutral-100">
                      {folder.name}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {formatFolderCounts(folder)} · incl. sub-folders · Last
                      used {formatDate(folder.lastUsedAt)}
                      {isActive && (
                        <span className="ml-2 text-neutral-400">· Active</span>
                      )}
                    </p>
                  </button>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void handleDelete(folder.id)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                    title="Remove from history"
                  >
                    Delete
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
