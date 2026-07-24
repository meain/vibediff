/** Scrolls a file's diff block (rendered in "all files" display mode) into view, matching FileDiff's `id="file-<path>"` convention. */
export function scrollFileIntoView(path: string): void {
  const element = document.getElementById(`file-${path.replace(/\//g, '-')}`)
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
