/**
 * Auto-Save Utilities
 * 
 * Debounced save functionality to prevent excessive database writes
 * while providing good UX feedback.
 * 
 * References: PRD Section 4.4 - Discovery Grid (Auto-Save)
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Debounce function - delays execution until after wait milliseconds
 * have elapsed since the last call.
 * 
 * @param func - Function to debounce
 * @param wait - Delay in milliseconds (default: 500ms)
 * @returns Debounced function
 */
export function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  wait: number = 500
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return function debounced(...args: Parameters<T>) {
    // Clear existing timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }

    // Set new timeout
    timeoutId = setTimeout(() => {
      func(...args)
      timeoutId = null
    }, wait)
  }
}

/**
 * Debounce function that returns a promise
 * Useful for async operations with loading states
 * 
 * @param func - Async function to debounce
 * @param wait - Delay in milliseconds (default: 500ms)
 * @returns Debounced async function
 */
export function debounceAsync<T extends (...args: never[]) => Promise<unknown>>(
  func: T,
  wait: number = 500
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pendingPromise: Promise<Awaited<ReturnType<T>>> | null = null

  return function debouncedAsync(...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
    // Clear existing timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }

    // Create new promise if none exists
    if (!pendingPromise) {
      pendingPromise = new Promise<Awaited<ReturnType<T>>>((resolve, reject) => {
        timeoutId = setTimeout(async () => {
          try {
            const result = (await func(...args)) as Awaited<ReturnType<T>>
            resolve(result)
          } catch (error) {
            reject(error)
          } finally {
            timeoutId = null
            pendingPromise = null
          }
        }, wait)
      })
    }

    return pendingPromise
  }
}

/**
 * Create a debounced save handler with status tracking
 * 
 * @param saveFunc - Async save function
 * @param onStatusChange - Callback when save status changes
 * @param wait - Delay in milliseconds (default: 500ms)
 * @returns Object with save, flush, cancel and setSaveFunc methods
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function createDebouncedSave<T extends (...args: never[]) => Promise<void>>(
  saveFunc: T,
  onStatusChange: (status: SaveStatus) => void,
  wait: number = 500
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let statusTimeoutId: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Parameters<T> | null = null
  let currentSaveFunc = saveFunc
  let isExecuting = false
  let generation = 0
  let flushed = false

  const schedulePending = () => {
    if (pendingArgs === null || isExecuting || timeoutId !== null) return

    timeoutId = setTimeout(
      () => {
        timeoutId = null
        const args = pendingArgs
        pendingArgs = null
        if (args === null) return

        const runGeneration = generation
        isExecuting = true
        void execute(args, runGeneration)
      },
      flushed ? 0 : wait
    )
  }

  const execute = async (args: Parameters<T>, runGeneration: number): Promise<void> => {
    try {
      await currentSaveFunc(...args)
      if (runGeneration !== generation || flushed) return

      if (pendingArgs === null) {
        onStatusChange('saved')
        statusTimeoutId = setTimeout(() => {
          statusTimeoutId = null
          if (runGeneration === generation) onStatusChange('idle')
        }, 2000)
      }
    } catch (error) {
      console.error('Auto-save error:', error)
      if (runGeneration !== generation || flushed) return

      if (pendingArgs === null) {
        onStatusChange('error')
        statusTimeoutId = setTimeout(() => {
          statusTimeoutId = null
          if (runGeneration === generation) onStatusChange('idle')
        }, 3000)
      }
    } finally {
      isExecuting = false
      schedulePending()
    }
  }

  const save = async (...args: Parameters<T>): Promise<void> => {
    if (
      pendingArgs !== null &&
      pendingArgs.length === 1 &&
      args.length === 1 &&
      isRecord(pendingArgs[0]) &&
      isRecord(args[0])
    ) {
      const pendingPatch: Record<string, unknown> = pendingArgs[0]
      const nextPatch: Record<string, unknown> = args[0]
      pendingArgs = [{ ...pendingPatch, ...nextPatch }] as unknown as Parameters<T>
    } else {
      pendingArgs = args
    }

    if (statusTimeoutId !== null) {
      clearTimeout(statusTimeoutId)
      statusTimeoutId = null
    }

    if (isExecuting) return

    if (timeoutId === null && !flushed) onStatusChange('saving')
    if (timeoutId !== null) clearTimeout(timeoutId)
    timeoutId = null
    schedulePending()
  }

  /**
   * Write the pending patch now instead of dropping it, for an owner that is
   * going away — an unmounting row's edit is still wanted even though its
   * status indicator is not (#190). Terminal once there is something to write:
   * from then on the handle keeps writing what it is given but never reports
   * status again.
   */
  const flush = () => {
    // Timers first, before the guard below can return: a status reset queued
    // behind a finished write outlives the owner it would render into.
    if (statusTimeoutId !== null) {
      clearTimeout(statusTimeoutId)
      statusTimeoutId = null
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    // Nothing to write, so nothing to make terminal. StrictMode runs every
    // effect cleanup once at mount while the handle behind it survives, and a
    // handle latched here would spend its whole life undebounced and silent.
    if (pendingArgs === null && !isExecuting) return

    flushed = true

    // A write is already in flight; its `finally` re-arms the queue, now at
    // 0ms. Starting a second one here would race the patch it supersedes.
    if (isExecuting) return

    const args = pendingArgs
    pendingArgs = null
    if (args === null) return

    isExecuting = true
    void execute(args, generation)
  }

  /**
   * Discard the pending patch. No caller in the app since #190 — an unmounting
   * row flushes instead — but it stays as the explicit "throw this away"
   * counterpart to `flush`.
   */
  const cancel = () => {
    generation += 1
    pendingArgs = null

    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (statusTimeoutId !== null) {
      clearTimeout(statusTimeoutId)
      statusTimeoutId = null
    }
  }

  const setSaveFunc = (nextSaveFunc: T) => {
    currentSaveFunc = nextSaveFunc
  }

  return { save, flush, cancel, setSaveFunc }
}

/**
 * Throttle function - ensures function is called at most once per interval
 * Useful for scroll/resize handlers
 * 
 * @param func - Function to throttle
 * @param limit - Minimum time between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: never[]) => unknown>(
  func: T,
  limit: number = 200
): (...args: Parameters<T>) => void {
  let inThrottle = false

  return function throttled(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
  }
}

