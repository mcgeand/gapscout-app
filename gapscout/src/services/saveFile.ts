/**
 * saveFile - Write a generated artefact to disk
 *
 * Shared by the export suite (PRD 4.12). Under Tauri this opens a native save
 * dialog; the dialog plugin adds the chosen path to the fs scope at runtime, so
 * writing to it needs no static path scope in tauri.conf.json.
 *
 * `saveFile` writes one file through a save dialog; `saveFilePack` writes a set
 * of related files into one chosen folder — see its comment for why a multi-file
 * export cannot use the save dialog.
 *
 * In a plain browser (`pnpm dev`, tests) it falls back to an anchor download.
 *
 * Tauri modules are imported lazily, matching services/db/tauriAdapter.ts, so
 * jsdom test runs never pull them in.
 */

export interface SaveFileFilter {
  name: string
  extensions: string[]
}

export interface SaveFileRequest {
  /** Pre-filled name in the save dialog, e.g. `p2p_diagram_2026-08-31.png`. */
  defaultName: string
  contents: Uint8Array
  filters?: SaveFileFilter[]
  /** MIME type used by the browser fallback. */
  mimeType?: string
}

/** Matches services/db.ts — Tauri injects this before any app code runs. */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Decode a `data:` URL into raw bytes.
 *
 * Both branches below write bytes rather than text so PNG and SVG share one path.
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma === -1) {
    throw new Error('Not a data URL')
  }

  const meta = dataUrl.slice(5, comma)
  const payload = dataUrl.slice(comma + 1)

  if (meta.endsWith(';base64')) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  return new TextEncoder().encode(decodeURIComponent(payload))
}

/**
 * Returns the path written to, or null when the user cancelled the dialog.
 * The browser fallback cannot report a path and returns the filename instead.
 */
export async function saveFile(request: SaveFileRequest): Promise<string | null> {
  if (isTauriEnvironment()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')

    const path = await save({
      defaultPath: request.defaultName,
      ...(request.filters ? { filters: request.filters } : {}),
    })

    if (!path) return null

    await writeFile(path, request.contents)
    return path
  }

  downloadInBrowser(request.defaultName, request.contents, request.mimeType)
  return request.defaultName
}

function downloadInBrowser(name: string, contents: Uint8Array, mimeType?: string): void {
  const blob = new Blob([contents as BlobPart], {
    type: mimeType ?? 'application/octet-stream',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  // Revoking in this task can cancel a download some browsers are still
  // resolving, which fails silently. Let the click settle first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export interface SaveFilePackFile {
  name: string
  contents: Uint8Array
  /** MIME type used by the browser fallback. */
  mimeType?: string
}

export interface SaveFilePackRequest {
  /** Written side by side; the first is the one the pack is named after. */
  files: SaveFilePackFile[]
  /** Folder-picker title, e.g. "Choose a folder for the Markdown pack". */
  title?: string
}

/**
 * Write several related files into one user-chosen folder.
 *
 * The Markdown pack is a `.md` plus its diagram image, and the image must sit
 * beside the document for the relative link to resolve. A `save()` dialog cannot
 * do that: tauri-plugin-dialog adds only the exact chosen file to the fs scope
 * (`allow_file`), so writing a sibling is denied. Picking a directory calls
 * `allow_directory` instead, which is what makes both writes legal.
 *
 * Returns the folder written to, or null when the user cancelled.
 *
 * Note there is no per-file overwrite prompt — the folder picker asks once.
 * Export filenames carry a date stamp, so a repeat export the same day
 * deliberately replaces that day's pack.
 */
export async function saveFilePack(request: SaveFilePackRequest): Promise<string | null> {
  if (request.files.length === 0) return null

  if (isTauriEnvironment()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')

    const directory = await open({
      directory: true,
      multiple: false,
      ...(request.title ? { title: request.title } : {}),
    })

    if (typeof directory !== 'string') return null

    for (const file of request.files) {
      await writeFile(await join(directory, file.name), file.contents)
    }

    return directory
  }

  // Browsers have no folder target, so each file downloads separately. Chrome
  // prompts once for "multiple downloads"; this path only runs under `pnpm dev`.
  for (const file of request.files) {
    downloadInBrowser(file.name, file.contents, file.mimeType)
  }

  return request.files[0].name
}
