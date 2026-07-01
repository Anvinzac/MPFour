interface EmptyStateProps {
  onOpenHistory?: () => void
}

export function EmptyState({ onOpenHistory }: EmptyStateProps) {
  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8">
        <svg
          className="mx-auto h-16 w-16 text-neutral-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      </div>
      <h2 className="mb-2 text-xl font-medium text-neutral-100">
        No media yet
      </h2>
      <p className="max-w-sm text-sm text-neutral-400">
        Click <strong className="font-medium text-neutral-300">Add Folder</strong>{' '}
        to pick a local directory. All sub-folders are scanned recursively.
        Photos and videos appear together in one mixed gallery.
      </p>
      {onOpenHistory && (
        <button
          type="button"
          onClick={onOpenHistory}
          className="mt-6 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
        >
          Open History
        </button>
      )}
    </div>
  )
}
