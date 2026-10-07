/**
 * The process position of every step and open process gap in the project, for
 * any surface that is not the Discovery grid.
 *
 * The grid builds its own map, because inside a milestone tab it deliberately
 * shows (and edits) the stored per-milestone `order` and its toasts and
 * confirmations have to cite the same number the reader can see. Everything
 * else — the gap drawer, the gaps table, the gap form, the diagram — is never
 * scoped to one milestone, so the running position across the whole process is
 * the only number that identifies a row unambiguously there (#345).
 */

import { useMemo } from 'react'
import { processPositions } from '../lib/stepSequence'
import { useGapsStore } from './gapsStore'
import { useStepsStore } from './stepsStore'

export function useProcessPositions(): Map<string, number> {
  const steps = useStepsStore((state) => state.steps)
  const milestones = useStepsStore((state) => state.milestones)
  const gaps = useGapsStore((state) => state.gaps)

  return useMemo(
    () => processPositions(steps, gaps, milestones),
    [steps, gaps, milestones]
  )
}
