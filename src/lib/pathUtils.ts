export function dirname(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash === -1 ? '' : relativePath.slice(0, slash)
}

export function formatSubfolderLabel(
  directoryPath: string,
  rootFolderName: string,
): string {
  return directoryPath ? `${rootFolderName} / ${directoryPath}` : rootFolderName
}
