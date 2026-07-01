import type { ActiveFolder } from '../types'

interface FolderChipsProps {
  folders: ActiveFolder[]
  onRemove: (folderId: string) => void
  onReconnect: (folderId: string) => void
  disabled?: boolean
}

export function FolderChips({
  folders,
  onRemove,
  onReconnect,
  disabled,
}: FolderChipsProps) {
  if (folders.length === 0) return null

  return (
    <div className="border-b border-neutral-800/80 bg-neutral-950/80 px-4 py-2">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Folders</span>
        {folders.map((folder) =>
          folder.needsPermission ? (
            <button
              key={folder.id}
              type="button"
              disabled={disabled}
              onClick={() => onReconnect(folder.id)}
              className="group inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-amber-800/60 bg-amber-950/40 px-3 py-1 text-xs text-amber-200 transition hover:bg-amber-900/50 disabled:opacity-50"
              title={`Access to ${folder.name} lapsed — click to reconnect`}
            >
              <span className="truncate font-medium">{folder.name}</span>
              <span className="shrink-0">Reconnect</span>
            </button>
          ) : (
            <button
              key={folder.id}
              type="button"
              disabled={disabled}
              onClick={() => onRemove(folder.id)}
              className="group inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-200 transition hover:border-red-800/60 hover:bg-red-950/40 disabled:opacity-50"
              title={`Remove ${folder.name} (${folder.fileCount} files in sub-folders)`}
            >
              <span className="truncate font-medium">{folder.name}</span>
              <span className="shrink-0 text-neutral-500 group-hover:text-red-400">
                {folder.imageCount > 0 && folder.videoCount > 0
                  ? `${folder.imageCount}p ${folder.videoCount}v`
                  : folder.fileCount}
              </span>
              <span
                className="shrink-0 text-neutral-500 group-hover:text-red-400"
                aria-hidden
              >
                ×
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  )
}
