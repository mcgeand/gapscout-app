/**
 * Unit tests for the shared save path (issue #152, PRD 4.12).
 *
 * Both branches are exercised: the native dialog + fs write under Tauri, and the
 * anchor-download fallback the browser dev server uses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'

import {
  dataUrlToBytes,
  isTauriEnvironment,
  saveFile,
  saveFilePack,
} from '../services/saveFile'

const mockSave = vi.mocked(save)
const mockOpen = vi.mocked(open)
const mockWriteFile = vi.mocked(writeFile)

/** Tauri sets this global before app code runs; jsdom does not have it. */
function withTauri(run: () => Promise<void>): Promise<void> {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  return run().finally(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  vi.clearAllMocks()
})

describe('isTauriEnvironment', () => {
  it('is false in jsdom and true once Tauri injects its globals', async () => {
    expect(isTauriEnvironment()).toBe(false)
    await withTauri(async () => {
      expect(isTauriEnvironment()).toBe(true)
    })
  })
})

describe('dataUrlToBytes', () => {
  it('decodes base64 payloads', () => {
    // "PNG" in base64.
    expect(Array.from(dataUrlToBytes('data:image/png;base64,UE5H'))).toEqual([80, 78, 71])
  })

  it('decodes percent-encoded text payloads, as html-to-image emits for SVG', () => {
    const bytes = dataUrlToBytes('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
    expect(new TextDecoder().decode(bytes)).toBe('<svg/>')
  })

  it('rejects anything that is not a data URL', () => {
    expect(() => dataUrlToBytes('https://example.com/a.png')).toThrow('Not a data URL')
  })
})

describe('saveFile under Tauri', () => {
  it('writes the bytes to the path chosen in the dialog', async () => {
    await withTauri(async () => {
      mockSave.mockResolvedValueOnce('/Users/danny/Desktop/p2p_diagram_2026-08-31.png')
      const contents = new Uint8Array([1, 2, 3])

      const path = await saveFile({
        defaultName: 'p2p_diagram_2026-08-31.png',
        contents,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      })

      expect(path).toBe('/Users/danny/Desktop/p2p_diagram_2026-08-31.png')
      expect(mockSave).toHaveBeenCalledWith({
        defaultPath: 'p2p_diagram_2026-08-31.png',
        filters: [{ name: 'PNG', extensions: ['png'] }],
      })
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/Users/danny/Desktop/p2p_diagram_2026-08-31.png',
        contents
      )
    })
  })

  it('writes nothing when the user cancels the dialog', async () => {
    await withTauri(async () => {
      mockSave.mockResolvedValueOnce(null)

      const path = await saveFile({
        defaultName: 'p2p_diagram_2026-08-31.png',
        contents: new Uint8Array([1]),
      })

      expect(path).toBeNull()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })
  })
})

describe('saveFile in the browser', () => {
  it('triggers an anchor download and cleans up the object URL', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const click = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = click
      return el
    })

    try {
      const path = await saveFile({
        defaultName: 'p2p_diagram_2026-08-31.svg',
        contents: new Uint8Array([1]),
        mimeType: 'image/svg+xml',
      })

      expect(path).toBe('p2p_diagram_2026-08-31.svg')
      expect(click).toHaveBeenCalledTimes(1)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(mockSave).not.toHaveBeenCalled()
      expect(document.querySelector('a')).toBeNull()

      // The revoke is deferred so it cannot cancel an in-flight download.
      expect(revokeObjectURL).not.toHaveBeenCalled()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    } finally {
      createElement.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})

/**
 * The Markdown pack (PRD 4.12.1) is a document plus its image, and the image
 * must land beside the document for the relative link in the .md to resolve.
 * A save dialog cannot do that — see services/saveFile.ts for the scope reason —
 * so these cover the folder-picker path instead.
 */
describe('saveFilePack under Tauri', () => {
  it('writes every file into the folder the user picked', async () => {
    await withTauri(async () => {
      mockOpen.mockResolvedValueOnce('/Users/danny/Desktop/pack')

      const folder = await saveFilePack({
        title: 'Choose a folder for the Markdown pack',
        files: [
          { name: 'p2p_process_doc_2026-09-02.md', contents: new Uint8Array([1]) },
          { name: 'p2p_diagram_2026-09-02.png', contents: new Uint8Array([2]) },
        ],
      })

      expect(mockOpen).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true, multiple: false })
      )
      expect(folder).toBe('/Users/danny/Desktop/pack')
      expect(mockWriteFile).toHaveBeenCalledTimes(2)
      expect(mockWriteFile).toHaveBeenNthCalledWith(
        1,
        '/Users/danny/Desktop/pack/p2p_process_doc_2026-09-02.md',
        new Uint8Array([1])
      )
      expect(mockWriteFile).toHaveBeenNthCalledWith(
        2,
        '/Users/danny/Desktop/pack/p2p_diagram_2026-09-02.png',
        new Uint8Array([2])
      )
    })
  })

  // A dismissed picker is a decision, not a failure: nothing is written and the
  // caller must not report an error.
  it('writes nothing when the picker is dismissed', async () => {
    await withTauri(async () => {
      mockOpen.mockResolvedValueOnce(null)

      const folder = await saveFilePack({
        files: [{ name: 'doc.md', contents: new Uint8Array([1]) }],
      })

      expect(folder).toBeNull()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })
  })

  it('never opens a picker for an empty pack', async () => {
    await withTauri(async () => {
      expect(await saveFilePack({ files: [] })).toBeNull()
      expect(mockOpen).not.toHaveBeenCalled()
    })
  })
})

describe('saveFilePack in the browser', () => {
  it('downloads each file separately, since a browser has no folder target', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const click = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = click
      return el
    })

    try {
      const result = await saveFilePack({
        files: [
          { name: 'doc.md', contents: new Uint8Array([1]), mimeType: 'text/markdown' },
          { name: 'diagram.png', contents: new Uint8Array([2]), mimeType: 'image/png' },
        ],
      })

      // The document is named first, so it is what the caller reports.
      expect(result).toBe('doc.md')
      expect(click).toHaveBeenCalledTimes(2)
      expect(createObjectURL).toHaveBeenCalledTimes(2)
      expect(mockOpen).not.toHaveBeenCalled()
    } finally {
      createElement.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
