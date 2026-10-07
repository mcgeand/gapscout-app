/**
 * In-app clipboard for diagram steps (#155).
 *
 * The buffer here is the source of truth for paste. The same payload is also
 * written to the OS clipboard as JSON so it can travel, but `readText` is not
 * relied on: WKWebView has not been proven to grant it, and the buffer makes
 * paste work regardless.
 */
import { create } from 'zustand'
import type { Step, StepBranch } from '../data/types'

/** The subset of a Step worth carrying between projects. Ids are the source ids. */
export interface CopiedStep {
  id: string
  label: string
  teamId: string
  milestoneId: string
  suppliers: string[]
  inputs: string[]
  outputs: string[]
  customers: string[]
  systems: string[]
  trigger?: string
  result?: string
  kpi?: string
  notes?: string
  decision?: boolean
  branches?: StepBranch[]
}

export interface StepClipboard {
  kind: 'gapscout/steps'
  version: 1
  sourceProjectId: string
  steps: CopiedStep[]
}

interface DiagramClipboardState {
  clipboard: StepClipboard | null
  /** Replace the buffer with these steps (in the given order) and return the payload. */
  copy: (steps: readonly Step[], sourceProjectId: string) => StepClipboard
  clear: () => void
}

/**
 * One copied step. Field by field rather than a spread, because a Step carries
 * things a paste must never inherit — its id is the *source* id (the paste
 * mints a fresh one), and `comments`, `links`, `gapIds`, `order` and
 * `diagramPosition` belong to where it came from.
 */
const toCopiedStep = (step: Step): CopiedStep => ({
  id: step.id,
  label: step.label,
  teamId: step.teamId,
  milestoneId: step.milestoneId,
  suppliers: [...(step.suppliers ?? [])],
  inputs: [...(step.inputs ?? [])],
  outputs: [...(step.outputs ?? [])],
  customers: [...(step.customers ?? [])],
  systems: [...(step.systems ?? [])],
  trigger: step.trigger,
  result: step.result,
  kpi: step.kpi,
  notes: step.notes,
  decision: step.decision,
  branches: step.branches ? step.branches.map(branch => ({ ...branch })) : undefined,
})

export const useDiagramClipboard = create<DiagramClipboardState>((set) => ({
  clipboard: null,
  copy: (steps, sourceProjectId) => {
    const clipboard: StepClipboard = {
      kind: 'gapscout/steps',
      version: 1,
      sourceProjectId,
      steps: steps.map(toCopiedStep),
    }
    set({ clipboard })
    return clipboard
  },
  clear: () => set({ clipboard: null }),
}))

/** JSON for the OS clipboard: the envelope above, pretty-printed. */
export function serializeClipboard(clipboard: StepClipboard): string {
  return JSON.stringify(clipboard, null, 2)
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

const isBranch = (value: unknown): value is StepBranch => {
  if (typeof value !== 'object' || value === null) return false
  const branch = value as Record<string, unknown>
  return (
    typeof branch.when === 'string' &&
    typeof branch.toStepId === 'string' &&
    isOptionalString(branch.label)
  )
}

const isCopiedStep = (value: unknown): value is CopiedStep => {
  if (typeof value !== 'object' || value === null) return false
  const step = value as Record<string, unknown>
  return (
    typeof step.id === 'string' &&
    typeof step.label === 'string' &&
    typeof step.teamId === 'string' &&
    typeof step.milestoneId === 'string' &&
    isStringArray(step.suppliers) &&
    isStringArray(step.inputs) &&
    isStringArray(step.outputs) &&
    isStringArray(step.customers) &&
    isStringArray(step.systems) &&
    isOptionalString(step.trigger) &&
    isOptionalString(step.result) &&
    isOptionalString(step.kpi) &&
    isOptionalString(step.notes) &&
    (step.decision === undefined || typeof step.decision === 'boolean') &&
    (step.branches === undefined || (Array.isArray(step.branches) && step.branches.every(isBranch)))
  )
}

/**
 * Parse text from the OS clipboard; null unless it is a valid envelope.
 *
 * Nothing is coerced and nothing is defaulted: a payload that is nearly right
 * is rejected rather than repaired, because the repair would be a guess at what
 * another app meant and the paste writes rows from it. Never throws — invalid
 * JSON is a `null`, not an exception, since every caller is a paste handler
 * with a user in front of it.
 */
export function parseClipboard(text: string): StepClipboard | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const envelope = parsed as Record<string, unknown>

  if (envelope.kind !== 'gapscout/steps') return null
  if (envelope.version !== 1) return null
  if (typeof envelope.sourceProjectId !== 'string') return null
  if (!Array.isArray(envelope.steps)) return null
  if (!envelope.steps.every(isCopiedStep)) return null

  return {
    kind: 'gapscout/steps',
    version: 1,
    sourceProjectId: envelope.sourceProjectId,
    steps: envelope.steps,
  }
}
