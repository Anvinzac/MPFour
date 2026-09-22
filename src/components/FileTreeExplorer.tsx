import { useCallback, useEffect, useState } from 'react'
import { listDirectory, pickDirectory, type PickerStartIn } from '../lib/fileScanner'
import { ensureReadPermission } from '../lib/folderStore'

interface LocationPreset {
  id: PickerStartIn
  label: string
}

const LOCATION_PRESETS: LocationPreset[] = [
  { id: 'home', label: 'Home' },
  { id: 'documents', label: 'Documents' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'pictures', label: 'Pictures' },
  { id: 'videos', label: 'Videos' },
  { id: 'music', label: 'Music' },
]

interface FileTreeExplorerProps {
  open: boolean
  initialPreset?: PickerStartIn
  onClose: () => void
  /**
   * Called with the sub-handle the user picked and a display name to use
   * (root name, or root / sub / sub for nested selections). The parent
   * (typically `useMediaPool.ingestFolder`) handles the actual scan + state.
   */
  onPick: (
    handle: FileSystemDirectoryHandle,
    name: string,
  ) => Promise<void> | void
}

interface BreadcrumbSegment {
  name: string
  path: string
}

function buildBreadcrumbs(rootName: string, currentPath: string): BreadcrumbSegment[] {
  const crumbs: BreadcrumbSegment[] = [{ name: rootName, path: '' }]
  if (!currentPath) return crumbs
  const parts = currentPath.split('/')
  let acc = ''
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
}

export function FileTreeExplorer({
  open,
  initialPreset,
  onClose,
  onPick,
}: FileTreeExplorerProps) {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(
    null,
  )
  const [rootName, setRootName] = useState<string>('')
  const [currentPath, setCurrentPath] = useState<string>('')
  const [directories, setDirectories] = useState<
    { name: string; handle: FileSystemDirectoryHandle }[]
  >([])
  const [mediaCount, setMediaCount] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingPreset, setPendingPreset] = useState<PickerStartIn | undefined>(
    initialPreset,
  )

  useEffect(() => {
    if (open) setPendingPreset(initialPreset)
  }, [open, initialPreset])

  const pickRoot = useCallback(async (startIn?: PickerStartIn) => {
    setError(null)
    setLoading(true)
    try {
      const handle = await pickDirectory(startIn)
      const granted = await ensureReadPermission(handle)
      if (!granted) {
        setError('Folder permission was denied')
        return
      }
      setRootHandle(handle)
      setRootName(handle.name)
      setCurrentPath('')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to open folder')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!rootHandle) {
      setDirectories([])
      setMediaCount(0)
      return
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const segments = currentPath.split('/').filter(Boolean)
        let handle = rootHandle
        for (const segment of segments) {
          handle = await handle.getDirectoryHandle(segment, { create: false })
        }
        const listing = await listDirectory(handle)
        if (!cancelled) {
          setDirectories(listing.directories)
          setMediaCount(listing.mediaCount)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to list folder')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rootHandle, currentPath])

  const navigateInto = useCallback((name: string) => {
    setCurrentPath((prev) => (prev ? `${prev}/${name}` : name))
  }, [])

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const resolveCurrentHandle = useCallback(async (): Promise<{
    handle: FileSystemDirectoryHandle
    name: string
  } | null> => {
    if (!rootHandle) return null
    const segments = currentPath.split('/').filter(Boolean)
    let handle = rootHandle
    for (const segment of segments) {
      handle = await handle.getDirectoryHandle(segment, { create: false })
    }
    const name = currentPath
      ? `${rootName} / ${currentPath.split('/').join(' / ')}`
      : rootName
    return { handle, name }
  }, [rootHandle, rootName, currentPath])

  const pickHere = useCallback(async () => {
    const resolved = await resolveCurrentHandle()
    if (!resolved) return
    setPicking(true)
    setError(null)
    try {
      await onPick(resolved.handle, resolved.name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add folder')
    } finally {
      setPicking(false)
    }
  }, [resolveCurrentHandle, onPick, onClose])

  if (!open) return null

  const breadcrumbs = rootHandle ? buildBreadcrumbs(rootName, currentPath) : []
  const hasContent = directories.length > 0 || mediaCount > 0
  const currentLeafName = currentPath
    ? currentPath.split('/').pop() ?? rootName
    : rootName

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(80vh,720px)] w-full max-w-2xl flex-col rounded-2xl border border-neutral-800 bg-neutral-950 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Browse files</h2>
            <p className="truncate text-xs text-neutral-500">
              {rootHandle
                ? 'Pick a folder to add to the gallery. Subfolders are included automatically.'
                : 'Choose a starting location. The browser asks for permission once per root.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!rootHandle ? (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
            {pendingPreset && (
              <button
                type="button"
                onClick={() => void pickRoot(pendingPreset)}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-left text-sm hover:border-neutral-500"
              >
                <div className="font-medium text-white">
                  Quick start:{' '}
                  {LOCATION_PRESETS.find((p) => p.id === pendingPreset)?.label}
                </div>
                <div className="text-xs text-neutral-500">
                  Opens the system picker at this location.
                </div>
              </button>
            )}
            <div className="mt-2 text-xs uppercase tracking-wider text-neutral-500">
              Common locations
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LOCATION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void pickRoot(preset.id)}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-sm hover:border-neutral-600"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void pickRoot()}
              className="mt-3 rounded-lg border border-neutral-700 px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-900"
            >
              Other (browse anywhere)…
            </button>
          </div>
        ) : (
          <>
            <nav
              className="flex flex-wrap items-center gap-1 border-b border-neutral-800 bg-neutral-950 px-5 py-2 text-xs"
              aria-label="Breadcrumb"
            >
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1
                return (
                  <span
                    key={crumb.path || '__root'}
                    className="flex items-center gap-1"
                  >
                    {idx > 0 && <span className="text-neutral-600">/</span>}
                    {isLast ? (
                      <span className="text-neutral-200">{crumb.name}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigateTo(crumb.path)}
                        className="rounded px-1 text-neutral-400 hover:text-white"
                      >
                        {crumb.name}
                      </button>
                    )}
                  </span>
                )
              })}
            </nav>

            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                  Loading…
                </div>
              ) : !hasContent ? (
                <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                  This folder is empty.
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {directories.map((dir) => (
                    <li key={dir.name}>
                      <button
                        type="button"
                        onClick={() => navigateInto(dir.name)}
                        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-900"
                      >
                        <span className="flex items-center gap-2">
                          <span aria-hidden className="text-neutral-500">
                            📁
                          </span>
                          <span className="truncate text-neutral-100">
                            {dir.name}
                          </span>
                        </span>
                        <span className="text-xs text-neutral-500">Open ›</span>
                      </button>
                    </li>
                  ))}
                  {mediaCount > 0 && (
                    <li className="mt-2 flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-xs text-neutral-400">
                      <span>
                        {mediaCount} media file{mediaCount === 1 ? '' : 's'} here
                      </span>
                      <span className="text-neutral-500">included on add</span>
                    </li>
                  )}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setRootHandle(null)
                  setRootName('')
                  setCurrentPath('')
                  setDirectories([])
                  setMediaCount(0)
                  setError(null)
                }}
                className="text-xs text-neutral-400 hover:text-white"
              >
                ← Choose a different root
              </button>
              <button
                type="button"
                onClick={() => void pickHere()}
                disabled={picking || loading || !rootHandle}
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {picking
                  ? 'Adding…'
                  : currentPath
                    ? `Add “${currentLeafName}” to gallery`
                    : `Add “${rootName}” to gallery`}
              </button>
            </div>
          </>
        )}

        {error && (
          <div className="border-t border-red-900/50 bg-red-950/50 px-5 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
