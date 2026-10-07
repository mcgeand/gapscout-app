/**
 * Pure planning for pasting copied steps into a project (#155). No I/O: the
 * modal calls this and then persists the result.
 */
import { MAX_LENGTH } from '../data/constants'
import type { Step } from '../data/types'
import type { StepClipboard } from '../state/diagramClipboard'

const COPY_SUFFIX = ' (copy)'

/**
 * The label a copy takes when the target already holds this one.
 *
 * The suffix has to fit: `StepSchema` caps a label at `MAX_LENGTH.STEP_LABEL`,
 * so appending to a label already at the cap plans a row the schema rejects —
 * and the paste would fail at the write with nothing said about why. The base
 * is trimmed instead, because the suffix is the part that carries the meaning.
 */
function withCopySuffix(label: string): string {
  const suffixed = `${label}${COPY_SUFFIX}`
  if (suffixed.length <= MAX_LENGTH.STEP_LABEL) return suffixed
  return `${label.slice(0, MAX_LENGTH.STEP_LABEL - COPY_SUFFIX.length)}${COPY_SUFFIX}`
}

export interface PasteOptions {
  targetProjectId: string
  targetMilestoneId: string
  /** A team id to assign to every pasted step, or 'keep' to carry each source teamId. */
  teamId: string | 'keep'
  /** Carry branches between the pasted steps, remapped to their fresh ids. */
  keepBranches: boolean
  /** The order the first pasted step takes; later ones count up from it. */
  firstOrder: number
  /** Labels already present in the target project, for the "(copy)" suffix. */
  existingLabels: ReadonlySet<string>
  mintId: () => string
}

/** A step ready for db.createStep, with its fresh id already minted. */
export type PlannedStep = Omit<Step, 'createdAt' | 'updatedAt'>

/**
 * Plan the rows a paste would write.
 *
 * Three rules carry the weight:
 *
 * 1. **Fresh ids, minted once per step up front.** The remap below needs every
 *    fresh id before it can rewrite the first branch, so the ids cannot be
 *    minted lazily inside the per-step loop.
 * 2. **Branches only survive inside the pasted set.** A branch to a step that
 *    was not copied would point at a row in the source project — a dangling
 *    edge the diagram cannot draw, and a foreign id stored in a project that
 *    has never heard of it. One that lands back on the pasting step after the
 *    remap goes the same way: a self-edge is not a branch.
 * 3. **The "(copy)" suffix is keyed on the target's labels only**, not on the
 *    labels this paste is adding. Pasting the same three steps twice into an
 *    empty milestone leaves three plain labels and then three "(copy)" ones,
 *    which is what the user can read; suffixing within the batch would number
 *    copies against a list nobody can see.
 *
 * Everything a paste must not inherit is dropped here rather than by the
 * caller: `comments`, `links` and `gapIds` are the source rows' history, and
 * `diagramPosition` would drop the pasted steps on top of their originals.
 */
export function planPaste(clipboard: StepClipboard, opts: PasteOptions): PlannedStep[] {
  const freshIds = clipboard.steps.map(() => opts.mintId())

  const remap = new Map<string, string>()
  clipboard.steps.forEach((step, index) => {
    remap.set(step.id, freshIds[index])
  })

  return clipboard.steps.map((step, index) => {
    const id = freshIds[index]

    const branches = opts.keepBranches
      ? (step.branches ?? []).flatMap(branch => {
          const toStepId = remap.get(branch.toStepId)
          if (!toStepId || toStepId === id) return []
          return [{ ...branch, toStepId }]
        })
      : []

    return {
      id,
      projectId: opts.targetProjectId,
      label: opts.existingLabels.has(step.label) ? withCopySuffix(step.label) : step.label,
      teamId: opts.teamId === 'keep' ? step.teamId : opts.teamId,
      milestoneId: opts.targetMilestoneId,
      order: opts.firstOrder + index,

      suppliers: [...step.suppliers],
      inputs: [...step.inputs],
      outputs: [...step.outputs],
      customers: [...step.customers],

      systems: [...step.systems],
      trigger: step.trigger,
      result: step.result,
      kpi: step.kpi,

      decision: step.decision,
      branches,

      notes: step.notes,
      comments: [],
      links: [],
      gapIds: [],
      diagramPosition: undefined,
    }
  })
}
