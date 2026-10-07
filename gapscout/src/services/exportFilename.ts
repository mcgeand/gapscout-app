/**
 * exportFilename - Shared naming for every generated artefact
 *
 * PRD 4.12 names each export `[project-slug]_[kind]_[YYYY-MM-DD].[ext]`, so the
 * slug and date live here rather than being re-derived per format.
 */

/**
 * Lowercase, hyphen-separated, ASCII-safe. Falls back to `project` when the name
 * has no usable characters, so a filename is never bare punctuation.
 */
export function slugifyProjectName(projectName: string): string {
  return (
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  )
}

/** Local date, not UTC: the stamp should match the day the user sees. */
function formatDateStamp(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function buildExportFilename(
  projectName: string,
  kind: string,
  extension: string,
  date: Date = new Date()
): string {
  return `${slugifyProjectName(projectName)}_${kind}_${formatDateStamp(date)}.${extension}`
}
