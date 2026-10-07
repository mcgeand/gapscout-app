import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Modal } from '../shared/Modal'
import { WizardRail } from '../shared/WizardRail'
import { useTeamsStore } from '../../state/teamsStore'
import { useSystemsStore } from '../../state/systemsStore'
import { parseSipocData } from '../../lib/sipocParser'
import type { Team } from '../../data/types'

/**
 * SIPOC Wizard — capture, review, landing (#220).
 *
 * It used to be five narrow modal pages that ended by writing steps straight to
 * SQLite in a loop, with no preview and no undo: the parser's five-step cap, its
 * team guesses and every sentence it could not read were all decided in silence
 * and discovered afterwards, in the grid.
 *
 * The flow is three phases now, and the seam between phases two and three is the
 * point of the whole thing:
 *
 * - **Capture** is one page — the process boundary on the left, the narrative in
 *   the middle, and the chain building on the right as you type.
 * - **Review** shows what the parser made of it: rows you can rename, reorder,
 *   split, add and remove; the owners it could not match, offered as a choice;
 *   the sentences it could not read, as rows rather than deletions; and the gaps
 *   it noticed, which are created only if you ask.
 * - **Landing** says what changed and takes you to it, in place of four
 *   auto-dismissing toasts and a silent tab switch.
 *
 * Nothing here touches the database. `onPreview` does every read and `onConfirm`
 * every write, both in `ProcessBoard`, which is where the project-scope guards
 * live and have to stay (`ProcessBoard.lifecycle`). Cancelling at Review
 * therefore writes nothing at all — not the summary, and not the sentinel
 * "Unassigned" team, which used to be created before parsing had even begun.
 *
 * The board mounts this only while it is open, so every phase, row and choice
 * below is discarded on close without anything having to reset it.
 */

export interface SipocData {
  suppliers: string[]
  inputs: string[]
  process: string
  outputs: string[]
  customers: string[]
}

/** One row of the Review table. `id` is local to this wizard, never a row id. */
export interface SipocReviewRow {
  id: string
  label: string
  /** A team the project already has. */
  teamId?: string
  /** A team to create at save time, when the user took the "create it" offer. */
  newTeamName?: string
  /** The owner the sentence named that no team matched. */
  ownerHint?: string
  /** The sentence this row came from, quoted back in the owner offer. */
  source?: string
  suppliers: string[]
  inputs: string[]
  outputs: string[]
  customers: string[]
}

/** A gap the parser noticed, and whether the user asked for it. */
export interface SipocReviewGap {
  id: string
  description: string
  /** The row it will attach to; undefined once that row is removed. */
  rowId?: string
  create: boolean
}

/** What `onPreview` answers with: a plan, or the reason there is not one. */
export type SipocPreview =
  | {
      kind: 'plan'
      rows: SipocReviewRow[]
      gaps: Array<{ description: string; stepIndex?: number }>
      unparsed: string[]
      warnings: string[]
      /** Teams as the database has them, which may be ahead of the store. */
      teams: Team[]
      milestoneName: string
      /** Process position the first new step will take. */
      appendAfterPosition: number
      /** Label of the step it lands behind, when there is one. */
      appendAfterLabel?: string
    }
  | { kind: 'summary-only'; reason: 'existing-rows'; steps: number; gaps: number }
  | { kind: 'summary-only'; reason: 'no-milestone'; steps: 0; gaps: 0 }

export interface SipocConfirmPlan {
  data: SipocData
  rows: SipocReviewRow[]
  gaps: SipocReviewGap[]
  /** True when the project already has work and only the summary is written. */
  summaryOnly: boolean
}

export interface SipocSaveResult {
  stepsCreated: number
  gapsCreated: number
  teamsCreated: number
  /** Process positions the new steps took, for the landing panel's sentence. */
  firstPosition: number
  lastPosition: number
  milestoneName: string
  appendAfterLabel?: string
  /** New steps with no input or output yet. */
  needsDetail: number
  summaryOnly: boolean
}

interface SipocWizardProps {
  isOpen: boolean
  onClose: () => void
  projectName: string
  initialData?: SipocData
  /**
   * Rows the project already has. Known before the interview starts, so the
   * wizard can say it will only update the summary rather than discovering it
   * after five pages (#379).
   */
  existingWork: { steps: number; gaps: number }
  onPreview: (data: SipocData) => Promise<SipocPreview | null>
  onConfirm: (plan: SipocConfirmPlan) => Promise<SipocSaveResult | null>
  onOpenDiscovery: () => void
  onOpenDiagram: () => void
}

const EMPTY_SIPOC: SipocData = {
  suppliers: [],
  inputs: [],
  process: '',
  outputs: [],
  customers: [],
}

const RAIL = ['Capture', 'Review', 'Save'] as const

type Phase = 'capture' | 'review' | 'landing'

/**
 * `one` when there is exactly one of them, `many` otherwise.
 *
 * Every count in this component is a number the user is about to act on, and
 * "1 gaps opened" reads as a bug in the count rather than in the label.
 */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Title Case, for a team name taken from mid-sentence prose. */
function titleCase(text: string): string {
  return text.replace(/\b[a-z]/g, letter => letter.toUpperCase())
}

/**
 * Split a label into two, at " and " when it has one and in the middle
 * otherwise. Splitting is how a sentence that packed two actions into one row
 * gets separated; the halves are editable either way, so a crude cut is
 * recoverable and a refusal to cut is not.
 */
function splitLabel(label: string): [string, string] {
  const conjunction = label.toLowerCase().indexOf(' and ')
  if (conjunction > 0) {
    return [
      label.slice(0, conjunction).trim(),
      titleCase(label.slice(conjunction + 5, conjunction + 6)) + label.slice(conjunction + 6),
    ]
  }

  const words = label.split(/\s+/)
  const half = Math.max(1, Math.ceil(words.length / 2))
  return [words.slice(0, half).join(' '), words.slice(half).join(' ') || label]
}

export default function SipocWizard({
  isOpen,
  onClose,
  projectName,
  initialData,
  existingWork,
  onPreview,
  onConfirm,
  onOpenDiscovery,
  onOpenDiagram,
}: SipocWizardProps) {
  const { teams } = useTeamsStore()
  const { systems } = useSystemsStore()

  const [phase, setPhase] = useState<Phase>('capture')
  const [data, setData] = useState<SipocData>(initialData || EMPTY_SIPOC)
  const [isBusy, setIsBusy] = useState(false)

  const [preview, setPreview] = useState<SipocPreview | null>(null)
  const [rows, setRows] = useState<SipocReviewRow[]>([])
  const [gaps, setGaps] = useState<SipocReviewGap[]>([])
  const [unparsed, setUnparsed] = useState<Array<{ id: string; text: string }>>([])
  const [result, setResult] = useState<SipocSaveResult | null>(null)

  // Input state for adding new items
  const [supplierInput, setSupplierInput] = useState('')
  const [inputInput, setInputInput] = useState('')
  const [outputInput, setOutputInput] = useState('')
  const [customerInput, setCustomerInput] = useState('')

  const hasExistingWork = existingWork.steps > 0 || existingWork.gaps > 0

  /**
   * The chain drawn beside the description as it is typed.
   *
   * Display only, and deliberately not the parse Review runs on: this one reads
   * the teams the store has, while `onPreview` reads them from the database
   * behind the project-scope guard. Nothing is written from either.
   */
  const livePreview = useMemo(
    () =>
      parseSipocData(
        {
          suppliers: data.suppliers,
          inputs: data.inputs,
          processDescription: data.process,
          outputs: data.outputs,
          customers: data.customers,
        },
        teams
      ),
    [data, teams]
  )

  const liveSteps = data.process.trim() ? livePreview.steps : []
  const sentencesRead = liveSteps.length + livePreview.unparsed.length
  const withAnOwner = liveSteps.filter(step => step.teamId).length

  const unresolved: string[] = []
  if (data.suppliers.length === 0) unresolved.push('no suppliers yet')
  if (data.inputs.length === 0) unresolved.push('no inputs yet')
  if (data.outputs.length === 0) unresolved.push('no outputs yet')
  if (data.customers.length === 0) unresolved.push('no customers yet')
  if (liveSteps.length === 0) unresolved.push('no steps read from the description')
  const unowned = liveSteps.length - withAnOwner
  if (unowned > 0) {
    unresolved.push(`${unowned} ${plural(unowned, 'step has', 'steps have')} no owner`)
  }

  const teamsForReview = preview?.kind === 'plan' ? preview.teams : teams
  const needsAnOwner = rows.filter(row => !row.teamId && !row.newTeamName).length
  const gapsToCreate = gaps.filter(gap => gap.create).length
  const emptyLabels = rows.some(row => !row.label.trim())

  const handleAddItem = (field: 'suppliers' | 'inputs' | 'outputs' | 'customers', value: string) => {
    if (!value.trim()) return
    setData(prev => ({ ...prev, [field]: [...prev[field], value.trim()] }))
    if (field === 'suppliers') setSupplierInput('')
    if (field === 'inputs') setInputInput('')
    if (field === 'outputs') setOutputInput('')
    if (field === 'customers') setCustomerInput('')
  }

  const handleRemoveItem = (
    field: 'suppliers' | 'inputs' | 'outputs' | 'customers',
    index: number
  ) => {
    setData(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }))
  }

  const handleReview = async () => {
    setIsBusy(true)
    try {
      const answer = await onPreview(data)
      if (!answer) return

      setPreview(answer)
      if (answer.kind === 'plan') {
        setRows(answer.rows)
        setUnparsed(answer.unparsed.map(text => ({ id: nanoid(), text })))
        setGaps(
          answer.gaps.map(gap => ({
            id: nanoid(),
            description: gap.description,
            rowId:
              gap.stepIndex !== undefined ? answer.rows[gap.stepIndex]?.id : undefined,
            // Opt-in: these are the parser's diagnostics, and a run that opened
            // four of them uninvited would make the Gaps tab useless.
            create: false,
          }))
        )
      }
      setPhase('review')
    } finally {
      setIsBusy(false)
    }
  }

  const handleConfirm = async () => {
    setIsBusy(true)
    try {
      const saved = await onConfirm({
        data,
        rows,
        gaps,
        summaryOnly: preview?.kind === 'summary-only',
      })
      if (!saved) return
      setResult(saved)
      setPhase('landing')
    } finally {
      setIsBusy(false)
    }
  }

  const moveRow = (index: number, delta: number) => {
    setRows(prev => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  const updateRow = (id: string, patch: Partial<SipocReviewRow>) => {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)))
  }

  const removeRow = (id: string) => {
    setRows(prev => prev.filter(row => row.id !== id))
    // A gap has nothing to attach to once its step is gone.
    setGaps(prev => prev.filter(gap => gap.rowId !== id))
  }

  const addRow = () => {
    setRows(prev => [
      ...prev,
      {
        id: nanoid(),
        label: '',
        suppliers: [],
        inputs: [],
        outputs: [],
        customers: [],
      },
    ])
  }

  const splitRow = (index: number) => {
    setRows(prev => {
      const row = prev[index]
      const [first, second] = splitLabel(row.label)
      const next = [...prev]
      next.splice(
        index,
        1,
        { ...row, label: first, outputs: [], customers: [] },
        { ...row, id: nanoid(), label: second, suppliers: [], inputs: [] }
      )
      return next
    })
  }

  const promoteUnparsed = (id: string, text: string) => {
    setUnparsed(prev => prev.filter(item => item.id !== id))
    setRows(prev => [
      ...prev,
      { id: nanoid(), label: text, suppliers: [], inputs: [], outputs: [], customers: [] },
    ])
  }

  if (!isOpen) return null

  const railPosition = phase === 'capture' ? 1 : phase === 'review' ? 2 : 3

  const footer =
    phase === 'capture' ? (
      <div className="flex w-full items-center justify-between">
        <button className="btn-secondary" onClick={onClose} disabled={isBusy}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => void handleReview()}
          disabled={isBusy || !data.process.trim()}
        >
          {isBusy
            ? 'Reading…'
            : `Review ${liveSteps.length} ${plural(liveSteps.length, 'step', 'steps')}`}
        </button>
      </div>
    ) : phase === 'review' ? (
      <div className="flex w-full items-center justify-between gap-gs-4">
        <button className="btn-secondary" onClick={() => setPhase('capture')} disabled={isBusy}>
          Back to the description
        </button>
        <div className="flex items-center gap-gs-4">
          <p className="text-[12px] text-gs-ink-muted">
            {preview?.kind === 'summary-only'
              ? 'The summary only — no process rows are touched.'
              : `${rows.length} ${plural(rows.length, 'step', 'steps')} · ${gapsToCreate} ${plural(
                  gapsToCreate,
                  'gap',
                  'gaps'
                )}${
                  preview?.kind === 'plan' && preview.appendAfterPosition > 1
                    ? ` · appended after step ${preview.appendAfterPosition - 1}`
                    : ''
                }`}
          </p>
          <button
            className="btn-primary"
            onClick={() => void handleConfirm()}
            disabled={
              isBusy ||
              emptyLabels ||
              (preview?.kind === 'plan' && rows.length === 0)
            }
          >
            {isBusy
              ? 'Saving…'
              : preview?.kind === 'summary-only'
                ? 'Save summary'
                : `Create ${rows.length} ${plural(rows.length, 'step', 'steps')}`}
          </button>
        </div>
      </div>
    ) : (
      <div className="flex w-full items-center justify-end gap-gs-2">
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            onClose()
            onOpenDiagram()
          }}
        >
          See the diagram
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            onClose()
            onOpenDiscovery()
          }}
        >
          Open the Discovery grid
        </button>
      </div>
    )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="SIPOC interview"
      description={
        phase === 'capture'
          ? `${projectName} · describe the process once; GapScout turns it into steps you review before anything is saved.`
          : phase === 'review'
            ? 'Nothing is saved yet. Fix owners, split or remove rows, then save — or go back and rewrite the description.'
            : 'Saved.'
      }
      size="wide"
      footer={footer}
      dismissOnBackdrop={false}
    >
      <div className="mb-gs-6">
        <WizardRail steps={RAIL} current={railPosition} />
      </div>

      {phase === 'capture' && (
        <div className="grid grid-cols-1 gap-gs-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* Left: the boundary of the process, not the fields of step one. */}
          <section className="flex flex-col gap-gs-4">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-gs-ink-muted">
              Where the process starts
            </h3>

            <div>
              <label className="label-field" htmlFor="sipoc-supplier">
                Suppliers
              </label>
              <p className="mb-gs-2 text-[12px] text-gs-ink-muted">
                Who hands work in from outside this process.
              </p>
              <div className="flex gap-gs-2">
                <select
                  id="sipoc-supplier"
                  className="select-field min-w-0 flex-1"
                  value={supplierInput}
                  onChange={e => setSupplierInput(e.target.value)}
                >
                  <option value="">Add team or system…</option>
                  {teams.length > 0 && (
                    <optgroup label="Teams">
                      {teams.map(team => (
                        <option key={team.id} value={team.name}>
                          {team.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {systems.length > 0 && (
                    <optgroup label="Systems">
                      {systems.map(system => (
                        <option key={system.id} value={system.name}>
                          {system.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  className="btn-secondary"
                  onClick={() => handleAddItem('suppliers', supplierInput)}
                  disabled={!supplierInput}
                >
                  Add
                </button>
              </div>
              <ChipList
                items={data.suppliers}
                onRemove={index => handleRemoveItem('suppliers', index)}
                emptyText="No suppliers yet"
              />
            </div>

            <div>
              <label className="label-field" htmlFor="sipoc-input">
                Inputs
              </label>
              <p className="mb-gs-2 text-[12px] text-gs-ink-muted">
                What has to exist before step one.
              </p>
              <div className="flex gap-gs-2">
                <input
                  id="sipoc-input"
                  type="text"
                  className="input-field min-w-0 flex-1"
                  placeholder="Type and press Enter"
                  value={inputInput}
                  onChange={e => setInputInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddItem('inputs', inputInput)
                    }
                  }}
                />
                <button
                  className="btn-secondary"
                  onClick={() => handleAddItem('inputs', inputInput)}
                  disabled={!inputInput.trim()}
                >
                  Add
                </button>
              </div>
              <ChipList
                items={data.inputs}
                onRemove={index => handleRemoveItem('inputs', index)}
                emptyText="No inputs yet"
              />
            </div>

            <p className="border-t-2 border-gs-rule-strong pt-gs-3 text-[12px] text-gs-ink-muted">
              These are the <strong className="text-gs-ink">boundary</strong> of the process, not
              the fields of step 1. Everything in between links up automatically — the output of one
              step becomes the input of the next.
            </p>
          </section>

          {/* Middle: the narrative. */}
          <section className="flex flex-col gap-gs-4">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-gs-ink-muted">
              What happens
            </h3>
            <div>
              <label className="label-field" htmlFor="sipoc-process">
                One sentence per action, in order
              </label>
              <p className="mb-gs-2 text-[12px] text-gs-ink-muted">
                Name the team that does it — &ldquo;Procurement validates the coding&rdquo; gets you
                a labelled, owned step.
              </p>
              <textarea
                id="sipoc-process"
                className="textarea-field w-full"
                rows={12}
                placeholder={
                  'Requester raises a purchase requisition in SAP.\n' +
                  'Procurement validates the coding and the vendor.\n' +
                  'The budget holder approves the spend.'
                }
                value={data.process}
                onChange={e => setData({ ...data, process: e.target.value })}
                autoFocus
              />
              {/* The counter is the point: parsing becomes legible as you type,
                  instead of being discovered at Finish. */}
              <p className="mt-gs-1 text-[12px] text-gs-ink-muted">
                {sentencesRead} {plural(sentencesRead, 'sentence', 'sentences')} ·{' '}
                {liveSteps.length} {plural(liveSteps.length, 'step', 'steps')} detected ·{' '}
                {withAnOwner} with an owner
              </p>
            </div>

            <div>
              <label className="label-field" htmlFor="sipoc-output">
                Outputs
              </label>
              <div className="flex gap-gs-2">
                <input
                  id="sipoc-output"
                  type="text"
                  className="input-field min-w-0 flex-1"
                  placeholder="What the process produces"
                  value={outputInput}
                  onChange={e => setOutputInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddItem('outputs', outputInput)
                    }
                  }}
                />
                <button
                  className="btn-secondary"
                  onClick={() => handleAddItem('outputs', outputInput)}
                  disabled={!outputInput.trim()}
                >
                  Add
                </button>
              </div>
              <ChipList
                items={data.outputs}
                onRemove={index => handleRemoveItem('outputs', index)}
                emptyText="No outputs yet"
              />
            </div>

            <div>
              <label className="label-field" htmlFor="sipoc-customer">
                Customers
              </label>
              <div className="flex gap-gs-2">
                <select
                  id="sipoc-customer"
                  className="select-field min-w-0 flex-1"
                  value={customerInput}
                  onChange={e => setCustomerInput(e.target.value)}
                >
                  <option value="">Add team or system…</option>
                  {teams.length > 0 && (
                    <optgroup label="Teams">
                      {teams.map(team => (
                        <option key={team.id} value={team.name}>
                          {team.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {systems.length > 0 && (
                    <optgroup label="Systems">
                      {systems.map(system => (
                        <option key={system.id} value={system.name}>
                          {system.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  className="btn-secondary"
                  onClick={() => handleAddItem('customers', customerInput)}
                  disabled={!customerInput}
                >
                  Add
                </button>
              </div>
              <ChipList
                items={data.customers}
                onRemove={index => handleRemoveItem('customers', index)}
                emptyText="No customers yet"
              />
            </div>
          </section>

          {/* Right: the chain, built live. */}
          <section className="flex flex-col gap-gs-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-gs-ink-muted">
              Chain preview
            </h3>

            {hasExistingWork && (
              <div className="border-2 border-gs-ink p-gs-3 text-[12px] text-gs-ink">
                <p className="font-bold">This project already has a process.</p>
                <p className="mt-gs-1 text-gs-ink-muted">
                  {existingWork.steps} {plural(existingWork.steps, 'step', 'steps')} and{' '}
                  {existingWork.gaps} process {plural(existingWork.gaps, 'gap', 'gaps')} are in the
                  grid already, so this interview updates the SIPOC summary and leaves those rows
                  alone. Editing the summary is all it will do.
                </p>
              </div>
            )}

            <div className="border-2 border-gs-rule-strong">
              <p className="bg-gs-ink px-gs-3 py-gs-2 font-mono text-[9.5px] font-bold tracking-[0.08em] text-gs-on-ink">
                IN
              </p>
              <p className="px-gs-3 py-gs-2 text-[12px] text-gs-ink">
                {data.suppliers.length > 0 ? data.suppliers.join(', ') : '—'}
              </p>
            </div>

            {liveSteps.length === 0 ? (
              <p className="border-2 border-gs-rule p-gs-3 text-[12px] text-gs-ink-muted">
                Steps appear here as you describe the process.
              </p>
            ) : (
              <ol className="flex flex-col gap-gs-2">
                {liveSteps.map((step, index) => {
                  const owner = teams.find(team => team.id === step.teamId)
                  return (
                    <li key={index} className="border-2 border-gs-rule p-gs-3">
                      <p className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-gs-ink-muted">
                        {String(index + 1).padStart(2, '0')} ·{' '}
                        {owner ? owner.name.toUpperCase() : 'NO OWNER'}
                      </p>
                      <p className="mt-gs-1 text-[12.5px] text-gs-ink">{step.label}</p>
                    </li>
                  )
                })}
              </ol>
            )}

            <div className="border-2 border-gs-rule-strong">
              <p className="bg-gs-ink px-gs-3 py-gs-2 font-mono text-[9.5px] font-bold tracking-[0.08em] text-gs-on-ink">
                OUT
              </p>
              <p className="px-gs-3 py-gs-2 text-[12px] text-gs-ink">
                {data.customers.length > 0 ? data.customers.join(', ') : '—'}
              </p>
            </div>

            {/* Validation as a running count in place of the modal-over-a-modal
                that used to open at Finish. */}
            {unresolved.length > 0 && (
              <p className="text-[12px] text-gs-accent-ink">
                <span className="sev sev-m">{unresolved.length} TO RESOLVE</span>{' '}
                <span className="text-gs-ink-muted">{unresolved.join(' · ')}</span>
              </p>
            )}
          </section>
        </div>
      )}

      {phase === 'review' && preview?.kind === 'summary-only' && (
        <div className="panel">
          <h3 className="text-[15px] font-bold text-gs-ink">
            {preview.reason === 'existing-rows'
              ? 'The process is already mapped'
              : 'This project has no milestone yet'}
          </h3>
          <p className="mt-gs-2 max-w-[62ch] text-[13px] text-gs-ink-muted">
            {preview.reason === 'existing-rows' ? (
              <>
                {projectName} has {preview.steps} {plural(preview.steps, 'step', 'steps')} and{' '}
                {preview.gaps} process {plural(preview.gaps, 'gap', 'gaps')} already. Generating over
                them would delete work done by hand, so the wizard saves your summary and leaves the
                process untouched. Add or change steps in the Discovery grid.
              </>
            ) : (
              <>
                Steps have to land in a milestone, and {projectName} has none. Your summary will
                still be saved. Add a milestone in Discovery, then run the interview again to
                generate steps from it.
              </>
            )}
          </p>
        </div>
      )}

      {phase === 'review' && preview?.kind === 'plan' && (
        <div className="flex flex-col gap-gs-4">
          <dl className="flex flex-wrap gap-gs-8 border-b-2 border-gs-rule-strong pb-gs-4">
            <Stat
              value={rows.length + unparsed.length}
              label={plural(rows.length + unparsed.length, 'sentence read', 'sentences read')}
            />
            <Stat
              value={rows.length}
              label={plural(rows.length, 'step to create', 'steps to create')}
            />
            <Stat
              value={needsAnOwner}
              label={plural(needsAnOwner, 'needs an owner', 'need an owner')}
            />
            <Stat value={gaps.length} label={plural(gaps.length, 'gap found', 'gaps found')} />
          </dl>

          <table className="tbl w-full">
            <thead>
              <tr>
                <th scope="col" className="w-12">
                  #
                </th>
                <th scope="col">Step label</th>
                <th scope="col" className="w-56">
                  Owner team
                </th>
                <th scope="col" className="w-56">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  {/* The running position in this table, not a stored order. */}
                  <td className="font-mono text-gs-ink-muted">{index + 1}</td>
                  <td>
                    <input
                      type="text"
                      aria-label={`Step ${index + 1} label`}
                      className="input-field w-full"
                      value={row.label}
                      onChange={e => updateRow(row.id, { label: e.target.value })}
                    />
                    {!row.teamId && row.ownerHint && (
                      <p className="mt-gs-2 text-[12px] text-gs-ink-muted">
                        From &ldquo;{row.source}&rdquo; — &ldquo;{row.ownerHint}&rdquo; isn&rsquo;t
                        a team in this project.{' '}
                        {row.newTeamName ? (
                          <>
                            <strong className="text-gs-ink">
                              {row.newTeamName} will be created.
                            </strong>{' '}
                            <button
                              className="underline"
                              onClick={() => updateRow(row.id, { newTeamName: undefined })}
                            >
                              Undo
                            </button>
                          </>
                        ) : (
                          <button
                            className="underline"
                            onClick={() =>
                              updateRow(row.id, { newTeamName: titleCase(row.ownerHint!) })
                            }
                          >
                            Create it as a team
                          </button>
                        )}
                      </p>
                    )}
                  </td>
                  <td>
                    <select
                      aria-label={`Owner team for step ${index + 1}`}
                      className="select-field w-full"
                      value={row.newTeamName ? '__new__' : (row.teamId ?? '')}
                      onChange={e =>
                        updateRow(row.id, {
                          teamId: e.target.value && e.target.value !== '__new__'
                            ? e.target.value
                            : undefined,
                          newTeamName: e.target.value === '__new__' ? row.newTeamName : undefined,
                        })
                      }
                    >
                      <option value="">Pick a team</option>
                      {row.newTeamName && (
                        <option value="__new__">{row.newTeamName} (new)</option>
                      )}
                      {teamsForReview.map(team => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-gs-2 text-[12px]">
                      <button
                        className="underline disabled:no-underline disabled:opacity-50"
                        onClick={() => moveRow(index, -1)}
                        disabled={index === 0}
                      >
                        Up
                      </button>
                      <button
                        className="underline disabled:no-underline disabled:opacity-50"
                        onClick={() => moveRow(index, 1)}
                        disabled={index === rows.length - 1}
                      >
                        Down
                      </button>
                      <button className="underline" onClick={() => splitRow(index)}>
                        Split
                      </button>
                      <button
                        className="text-gs-accent-ink underline"
                        onClick={() => removeRow(row.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* A sentence the parser could not read is a row, not a deletion:
                  edit-in-place alone cannot recover a step it dropped. */}
              {unparsed.map(item => (
                <tr key={item.id}>
                  <td className="font-mono text-gs-ink-muted">—</td>
                  <td colSpan={2}>
                    <span className="sev sev-l">NOT PARSED</span>{' '}
                    <span className="text-gs-ink">&ldquo;{item.text}&rdquo;</span>{' '}
                    <span className="text-gs-ink-muted">— no action verb found</span>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-gs-2 text-[12px]">
                      <button
                        className="underline"
                        onClick={() => promoteUnparsed(item.id, item.text)}
                      >
                        Make it a step
                      </button>
                      <button
                        className="text-gs-ink-muted underline"
                        onClick={() =>
                          setUnparsed(prev => prev.filter(other => other.id !== item.id))
                        }
                      >
                        Ignore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <button className="btn-secondary" onClick={addRow}>
              Add a step
            </button>
          </div>

          {gaps.length > 0 && (
            <section className="border-2 border-gs-rule p-gs-4">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-gs-ink-muted">
                {gaps.length} {plural(gaps.length, 'gap', 'gaps')} noticed
              </h3>
              <p className="mt-gs-1 text-[12px] text-gs-ink-muted">
                None of these is created unless you ask for it.
              </p>
              <ul className="mt-gs-3 flex flex-col gap-gs-2">
                {gaps.map(gap => (
                  <li key={gap.id} className="flex items-start gap-gs-2 text-[12.5px]">
                    <input
                      id={`gap-${gap.id}`}
                      type="checkbox"
                      className="mt-[3px]"
                      checked={gap.create}
                      onChange={e =>
                        setGaps(prev =>
                          prev.map(other =>
                            other.id === gap.id ? { ...other, create: e.target.checked } : other
                          )
                        )
                      }
                    />
                    <label htmlFor={`gap-${gap.id}`} className="text-gs-ink">
                      Create as an open gap: {gap.description}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preview.warnings.length > 0 && (
            <ul className="flex flex-col gap-gs-1 text-[12px] text-gs-ink-muted">
              {preview.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}

          <p className="text-[12px] text-gs-ink-muted">
            Steps land in <strong className="text-gs-ink">{preview.milestoneName}</strong>
            {preview.appendAfterLabel
              ? `, after “${preview.appendAfterLabel}”.`
              : ', which has no steps yet.'}
            {needsAnOwner > 0 &&
              ` ${needsAnOwner} ${plural(needsAnOwner, 'step has', 'steps have')} no owner and will be filed under a team called Unassigned.`}
          </p>
        </div>
      )}

      {phase === 'landing' && result && (
        <div className="flex flex-col gap-gs-4">
          <div>
            <p className="font-mono text-[9.5px] font-bold tracking-[0.08em] text-gs-ink-muted">
              DONE
            </p>
            <h3 className="mt-gs-1 text-[19px] font-bold text-gs-ink">
              {result.summaryOnly
                ? `SIPOC summary saved for ${projectName}`
                : `${result.stepsCreated} ${plural(result.stepsCreated, 'step', 'steps')}${
                    result.gapsCreated > 0
                      ? ` and ${result.gapsCreated} ${plural(result.gapsCreated, 'gap', 'gaps')}`
                      : ''
                  } added to ${projectName}`}
            </h3>
            <p className="mt-gs-2 max-w-[62ch] text-[13px] text-gs-ink-muted">
              {result.summaryOnly ? (
                <>The process rows were left exactly as they were.</>
              ) : (
                <>
                  {result.firstPosition === result.lastPosition
                    ? `Step ${result.firstPosition}`
                    : `Steps ${result.firstPosition}–${result.lastPosition}`}
                  {result.appendAfterLabel
                    ? `, appended after “${result.appendAfterLabel}”`
                    : `, at the start of ${result.milestoneName}`}
                  .{' '}
                </>
              )}
              The SIPOC boundary is saved with the project, so Edit re-opens this interview filled
              in rather than blank.
            </p>
          </div>

          {!result.summaryOnly && (
            <>
              <dl className="flex flex-wrap gap-gs-8 border-y-2 border-gs-rule-strong py-gs-4">
                <Stat
                  value={result.stepsCreated}
                  label={plural(result.stepsCreated, 'step created', 'steps created')}
                />
                <Stat
                  value={result.gapsCreated}
                  label={plural(result.gapsCreated, 'gap opened', 'gaps opened')}
                />
                <Stat
                  value={result.teamsCreated}
                  label={plural(result.teamsCreated, 'team created', 'teams created')}
                />
                <Stat
                  value={result.needsDetail}
                  label={plural(result.needsDetail, 'needs SIPOC detail', 'need SIPOC detail')}
                />
              </dl>
              {result.needsDetail > 0 && (
                <p className="max-w-[62ch] text-[13px] text-gs-ink-muted">
                  {result.needsDetail}{' '}
                  {plural(result.needsDetail, 'step has', 'steps have')} no input or output yet — the
                  chain fills those in as you complete neighbouring rows, or you can fill them now in
                  the grid.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

/**
 * One figure from the review or landing header.
 *
 * `dt` carries the label and `dd` the number, in that DOM order because a
 * definition list requires it; the mock reads number-then-label, which is what
 * the `order` utilities do. Naming the label once rather than repeating it in an
 * `sr-only` term keeps one string on screen and one in the accessibility tree.
 */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-gs-2">
      <dt className="order-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] text-gs-ink-muted">
        {label}
      </dt>
      <dd className="order-1 text-[24px] font-bold leading-none text-gs-ink">{value}</dd>
    </div>
  )
}

function ChipList({
  items,
  onRemove,
  emptyText,
}: {
  items: string[]
  onRemove: (index: number) => void
  emptyText: string
}) {
  if (items.length === 0) {
    return <p className="mt-gs-2 text-[12px] text-gs-ink-faint">{emptyText}</p>
  }

  return (
    <ul className="mt-gs-2 flex flex-wrap gap-gs-2">
      {items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className="inline-flex items-center gap-gs-2 border-2 border-gs-rule px-gs-2 py-gs-1 text-[12px] text-gs-ink"
        >
          {item}
          <button
            className="text-gs-ink-muted hover:text-gs-accent-ink"
            onClick={() => onRemove(index)}
            aria-label={`Remove ${item}`}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </li>
      ))}
    </ul>
  )
}
