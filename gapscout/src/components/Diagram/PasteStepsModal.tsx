/**
 * Paste copied steps into this project (#155). Reads the in-app clipboard,
 * lets the user pick a milestone and team, and creates the steps with fresh ids.
 *
 * StepEditModal's grammar throughout (#218): a `<Modal>` around a `<form>` of
 * `<section>`s under `form-section-head` rules, controls on `select-field`, and
 * a footer whose submit reaches the form through `form={FORM_ID}`.
 *
 * **Both write paths are the same loop**, one `openSlotForInsert` per row —
 * open and fill as one operation, because the window between them is what a
 * concurrent reseal closes. They differ only in where the first order comes
 * from:
 *
 * - **After an anchor**, when the menu opened on a node and the chosen
 *   milestone is still that node's: the anchor's own order, plus one.
 * - **Appended**, otherwise: `nextPosition` reads the milestone back out of the
 *   database rather than off a store snapshot that a background reload may
 *   already have overtaken. A slot opened past the end shifts nothing, so the
 *   append costs the lock and nothing else — and taking the lock is the point,
 *   because a bare write is what lands on an order a concurrent insert has
 *   just claimed.
 *
 * Both then reseal once. `openSlotForInsert` defers the milestone-wide gap
 * re-sync to the reseal that follows it (it passes `resync: false` itself), so
 * a paste that skipped the reseal would leave every gap in the milestone worded
 * against the sequence as it was before the paste. The reseal reloads the steps
 * itself, so nothing here reloads after it.
 *
 * A run that fails partway says so. Rows already written are committed — the
 * Tauri adapter has no transaction primitive (#236) — so the honest report is
 * the count, and the dialog closes on it: left open, its Paste button would
 * write the surviving rows a second time.
 */
import { useId, useState, type FormEvent } from 'react'
import { nanoid } from 'nanoid'
import toast from 'react-hot-toast'
import { Modal } from '../shared/Modal'
import type { Step } from '../../data/types'
import { planPaste } from '../../lib/pastePlan'
import { nextPosition } from '../../lib/sequence'
import { createStep } from '../../services/db'
import { useDiagramClipboard } from '../../state/diagramClipboard'
import { useStepsStore } from '../../state/stepsStore'
import { useTeamsStore } from '../../state/teamsStore'
import { openSlotForInsert, resealAfterMutation } from '../../state/sequenceOps'
import { captureProjectScope, isProjectScopeCurrent } from '../../state/workspaceScope'

/** Ties the footer's submit button to the form inside the shell's body. */
const FORM_ID = 'paste-steps-form'

/** The select value that carries each copied step's own team rather than one team. */
const KEEP_TEAMS = 'keep'

const plural = (count: number) => `${count} step${count === 1 ? '' : 's'}`

export interface PasteStepsModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
  /** When opened from a node's menu: paste after this step, in its milestone. */
  anchorStep?: Step | null
}

export function PasteStepsModal({ projectId, isOpen, onClose, anchorStep }: PasteStepsModalProps) {
  const clipboard = useDiagramClipboard(state => state.clipboard)
  const { steps, milestones } = useStepsStore()
  const { teams } = useTeamsStore()

  const uid = useId()
  const id = (name: string) => `${uid}-${name}`

  const copied = clipboard?.steps ?? []

  /**
   * Where the steps go by default: the node the menu opened on, else the
   * milestone they were copied from when this project happens to have it, else
   * the first one. A copied milestone id from another project resolves to
   * nothing here, which is why it is checked against the list rather than used.
   */
  const defaultMilestoneId =
    anchorStep?.milestoneId ??
    copied.map(step => step.milestoneId).find(candidate => milestones.some(m => m.id === candidate)) ??
    milestones[0]?.id ??
    ''

  /**
   * Whether "keep" is even an option. Every copied team id has to resolve here,
   * because `steps.team_id` is NOT NULL and a step carrying a team from another
   * project is the dangling FK of #104 — written on purpose this time.
   */
  const canKeepTeams = copied.length > 0 && copied.every(step => teams.some(t => t.id === step.teamId))

  const defaultTeamId = canKeepTeams ? KEEP_TEAMS : teams[0]?.id ?? ''

  // `null` means "the user has not chosen", so the defaults above stay live
  // while the clipboard or the anchor changes underneath an open dialog. A
  // prop-syncing effect would do the same thing and need a lint disable.
  const [chosenMilestoneId, setChosenMilestoneId] = useState<string | null>(null)
  const [chosenTeamId, setChosenTeamId] = useState<string | null>(null)
  const [keepBranches, setKeepBranches] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const milestoneId = chosenMilestoneId ?? defaultMilestoneId

  // "Keep" can be chosen and then stop being offered: the buffer changes under
  // an open dialog and one of the new steps carries a team this project does
  // not have. The choice has to lapse with the option, or the paste writes the
  // source project's team ids — the dangling FK of #104, by a slower route.
  const chosenOrDefaultTeamId = chosenTeamId ?? defaultTeamId
  const teamId =
    chosenOrDefaultTeamId === KEEP_TEAMS && !canKeepTeams ? defaultTeamId : chosenOrDefaultTeamId

  const handleClose = () => {
    setChosenMilestoneId(null)
    setChosenTeamId(null)
    setKeepBranches(true)
    onClose()
  }

  const handlePaste = async () => {
    if (!clipboard || copied.length === 0) return

    if (!milestoneId) {
      toast.error('Milestone is required')
      return
    }
    if (!teamId) {
      toast.error('Owner team is required')
      return
    }

    const scope = captureProjectScope(projectId)
    if (!scope) return

    // Directly after the anchor only while the chosen milestone is still its
    // own: `order` is scoped to the milestone (#299), so the anchor's number
    // names a position in a sequence the paste would be leaving.
    const anchoredHere = !!anchorStep && anchorStep.milestoneId === milestoneId

    // Rows written so far. Read in the catch, where it is the difference
    // between "nothing happened, try again" and "some of this is now in the
    // database and a retry would double it".
    let written = 0
    const total = copied.length

    setIsSubmitting(true)
    try {
      const firstOrder = anchoredHere
        ? anchorStep.order + 1
        : await nextPosition(projectId, milestoneId)
      if (!isProjectScopeCurrent(scope)) return

      const planned = planPaste(clipboard, {
        targetProjectId: projectId,
        targetMilestoneId: milestoneId,
        teamId,
        keepBranches,
        firstOrder,
        existingLabels: new Set(steps.map(step => step.label)),
        mintId: nanoid,
      })

      const now = Date.now()

      for (const [index, plan] of planned.entries()) {
        const { id: freshId, ...data } = plan
        const row = { ...data, createdAt: now, updatedAt: now }

        // Under the lock on both paths. The append's slot lands past the end
        // and shifts nothing, so this costs one lock and buys the guarantee a
        // bare `createStep` cannot give: no concurrent insert or reseal can
        // claim this order between reading it and writing it.
        await openSlotForInsert({
          projectId,
          milestoneId,
          at: firstOrder + index,
          scope,
          write: async () => {
            await createStep(row, freshId)
          },
        })
        written += 1
        if (!isProjectScopeCurrent(scope)) return
      }

      // Open, write, THEN reseal — `openSlotForInsert`'s contract, and the pass
      // that brings the milestone's gap wording up to date after the sequence
      // changed. It reloads the steps itself (`reloadAndResync`), so there is
      // no reload here.
      await resealAfterMutation({ projectId, milestoneIds: [milestoneId], scope })
      if (!isProjectScopeCurrent(scope)) return

      toast.success(`Pasted ${plural(total)}`)
      handleClose()
    } catch (error) {
      console.error('Failed to paste steps:', error)
      if (!isProjectScopeCurrent(scope)) return

      if (written === 0) {
        toast.error('Could not paste the steps')
        return
      }

      // Some rows are in the database. Settle the sequence they left holed and
      // reload, then say how many landed and close: a dialog left open here
      // invites a retry that would write those rows a second time. Nested,
      // because a reseal that also fails must not lose the count.
      try {
        await resealAfterMutation({ projectId, milestoneIds: [milestoneId], scope })
      } catch (resealError) {
        console.error('Failed to reseal after a partial paste:', resealError)
      }
      if (!isProjectScopeCurrent(scope)) return

      toast.error(`Pasted ${written} of ${plural(total)}`)
      handleClose()
    } finally {
      // In a `finally` because the handler returns early on the stale-scope
      // checks; without it the button would read "Pasting..." for good.
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handlePaste()
  }

  if (copied.length === 0) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Paste steps"
        size="md"
        footer={
          <button type="button" onClick={handleClose} className="btn-secondary">
            Cancel
          </button>
        }
      >
        <p className="text-sm text-gs-ink-muted">
          Nothing copied yet — right-click a step and choose Copy as JSON.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Paste ${plural(copied.length)}`}
      description="Fresh copies, appended to the milestone you choose"
      size="lg"
      footer={
        <div className="flex items-center gap-gs-2">
          <button type="button" onClick={handleClose} disabled={isSubmitting} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form={FORM_ID} disabled={isSubmitting} className="btn-primary">
            {isSubmitting ? 'Pasting...' : `Paste ${plural(copied.length)}`}
          </button>
        </div>
      }
    >
      <form id={FORM_ID} className="flex flex-col gap-gs-6" onSubmit={handleSubmit}>
        <section>
          <div className="form-section-head">
            <h3 className="form-section-title">Where</h3>
            <span className="form-section-note">Required to save</span>
          </div>

          <div className="grid grid-cols-2 gap-gs-4">
            <div>
              <label className="label-field" htmlFor={id('milestone')}>
                Milestone
              </label>
              <select
                id={id('milestone')}
                value={milestoneId}
                onChange={(e) => setChosenMilestoneId(e.target.value)}
                className="select-field w-full"
              >
                {milestones.map(milestone => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-field" htmlFor={id('team')}>
                Owner team
              </label>
              <select
                id={id('team')}
                value={teamId}
                onChange={(e) => setChosenTeamId(e.target.value)}
                className="select-field w-full"
              >
                {canKeepTeams && <option value={KEEP_TEAMS}>Keep each step&apos;s owner team</option>}
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section>
          <div className="form-section-head">
            <h3 className="form-section-title">Connections</h3>
          </div>

          <label className="flex items-center gap-gs-2">
            <input
              type="checkbox"
              checked={keepBranches}
              onChange={(e) => setKeepBranches(e.target.checked)}
            />
            <span className="text-sm font-medium text-gs-ink">
              Keep connections between the pasted steps
            </span>
          </label>
          <p className="mt-gs-1 text-xs text-gs-ink-muted">
            Branches to steps outside the copied set are dropped
          </p>

          {/* The copied set, in the order it will be written. An ordered list
              rather than a numbered string: "Step 2" would read as a process
              position, and the stored `order` belongs to the milestone these
              came from and names nothing here (#345). The list marker numbers
              the buffer and claims nothing about the process. */}
          <ol className="mt-gs-4 list-inside list-decimal space-y-gs-1 text-sm text-gs-ink-muted">
            {copied.map((step, index) => (
              <li key={`${step.id}-${index}`}>{step.label}</li>
            ))}
          </ol>
        </section>
      </form>
    </Modal>
  )
}

export default PasteStepsModal
