import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDebouncedSave, type SaveStatus } from '../lib/autosave'

describe('createDebouncedSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces repeated edits while preserving distinct field edits', async () => {
    const savedValues: Array<Record<string, string>> = []
    const save = createDebouncedSave(
      async (updates: Record<string, string>) => {
        savedValues.push(updates)
      },
      vi.fn(),
      100
    )

    save.save({ label: 'first' })
    save.save({ inputs: 'input' })
    save.save({ label: 'latest' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(savedValues).toEqual([{ label: 'latest', inputs: 'input' }])
  })

  it('preserves distinct field edits received while the previous write is in flight', async () => {
    let resolveFirstWrite!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve
    })
    const savedValues: Array<Record<string, string>> = []
    const save = createDebouncedSave(
      async (updates: Record<string, string>) => {
        savedValues.push(updates)
        if (updates.label === 'first') await firstWrite
      },
      vi.fn(),
      100
    )

    save.save({ label: 'first' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    save.save({ inputs: 'input' })
    save.save({ label: 'latest' })
    expect(savedValues).toEqual([{ label: 'first' }])

    resolveFirstWrite()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(savedValues).toEqual([{ label: 'first' }])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(savedValues).toEqual([
      { label: 'first' },
      { inputs: 'input', label: 'latest' },
    ])
  })

  it('writes the pending edit on flush instead of dropping it', async () => {
    const savedValues: Array<Record<string, string>> = []
    const statuses: SaveStatus[] = []
    const save = createDebouncedSave(
      async (updates: Record<string, string>) => {
        savedValues.push(updates)
      },
      (status) => statuses.push(status),
      100
    )

    save.save({ label: 'unmounted mid-window' })
    save.flush()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(savedValues).toEqual([{ label: 'unmounted mid-window' }])
    // 'saving' was reported before the flush; nothing is reported after it,
    // because the owner that would render it is gone.
    expect(statuses).toEqual(['saving'])
  })

  it('drops the queued status reset when flushed after a settled write', async () => {
    const statuses: SaveStatus[] = []
    const save = createDebouncedSave(async () => {}, (status) => statuses.push(status), 100)

    save.save()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(statuses).toEqual(['saving', 'saved'])

    // Unmounting inside the 2s 'saved' window: the reset has nothing left to
    // render into, so it must not outlive the owner.
    save.flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(statuses).toEqual(['saving', 'saved'])
  })

  it('reports no error status for a rejected write flushed on unmount', async () => {
    const statuses: SaveStatus[] = []
    const save = createDebouncedSave(
      async () => {
        throw new Error('write failed')
      },
      (status) => statuses.push(status),
      100
    )

    save.save()
    save.flush()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(statuses).toEqual(['saving'])
  })

  it('leaves an idle handle debounced when flushed with nothing pending', async () => {
    const savedValues: Array<Record<string, string>> = []
    const statuses: SaveStatus[] = []
    const save = createDebouncedSave(
      async (updates: Record<string, string>) => {
        savedValues.push(updates)
      },
      (status) => statuses.push(status),
      100
    )

    // What StrictMode does at mount: cleanup runs while nothing is pending.
    save.flush()
    save.save({ label: 'later' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(savedValues).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(savedValues).toEqual([{ label: 'later' }])
    expect(statuses).toEqual(['saving', 'saved'])
  })

  it('flushes the patch queued behind an in-flight write without racing it', async () => {
    let resolveFirstWrite!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve
    })
    const savedValues: Array<Record<string, string>> = []
    const save = createDebouncedSave(
      async (updates: Record<string, string>) => {
        savedValues.push(updates)
        if (updates.label === 'first') await firstWrite
      },
      vi.fn(),
      100
    )

    save.save({ label: 'first' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(savedValues).toEqual([{ label: 'first' }])

    save.save({ label: 'latest' })
    save.flush()

    // The in-flight write still owns the queue, so the flushed patch waits.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(savedValues).toEqual([{ label: 'first' }])

    resolveFirstWrite()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(savedValues).toEqual([{ label: 'first' }, { label: 'latest' }])
  })

  it('reports no status for a write that settles after a flush', async () => {
    let resolveWrite!: () => void
    const write = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    const statuses: SaveStatus[] = []
    const save = createDebouncedSave(
      async () => {
        await write
      },
      (status) => statuses.push(status),
      100
    )

    save.save()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(statuses).toEqual(['saving'])

    save.flush()
    resolveWrite()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(statuses).toEqual(['saving'])
  })

  it('suppresses status transitions from an in-flight write after cancellation', async () => {
    let resolveWrite!: () => void
    const write = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    const statuses: SaveStatus[] = []
    const save = createDebouncedSave(
      async () => {
        await write
      },
      (status) => statuses.push(status),
      100
    )

    save.save()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(statuses).toEqual(['saving'])

    save.cancel()
    resolveWrite()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(statuses).toEqual(['saving'])
  })
})
