/**
 * SIPOC Parser - Smart logic for generating process steps from SIPOC data
 *
 * Takes raw SIPOC wizard data (Suppliers, Inputs, Process, Outputs, Customers)
 * and generates initial Step records with smart linking and gap detection.
 *
 * References: PRD Section 4.2 - SIPOC Wizard (On Completion)
 */

import type { Step, Team } from '../data/types'

// ============================================================================
// Types
// ============================================================================

export interface SipocData {
  suppliers: string[]
  inputs: string[]
  processDescription: string
  outputs: string[]
  customers: string[]
}

export interface ParsedStep {
  label: string
  suppliers: string[]
  inputs: string[]
  outputs: string[]
  customers: string[]
  /**
   * Resolved team, or `undefined` when the sentence named an owner this project
   * has no team for. The Review step turns that into a choice — create the team
   * or map it to an existing one (#220) — so it is deliberately not filled with
   * a fallback here.
   */
  teamId?: string
  /**
   * The owner the sentence named, when it named one the project does not have.
   * Set only alongside an undefined `teamId`; `source` is the sentence it came
   * from, so the offer can quote what was typed.
   */
  ownerHint?: string
  source?: string
  order: number
}

export interface ParseResult {
  steps: ParsedStep[]
  gaps: Array<{
    type: 'input' | 'output' | 'process'
    description: string
    relatedSteps: number[] // Indices of steps involved
  }>
  /**
   * Sentences the parser could not read as an action. These used to be summarised
   * into a `warnings` line and toasted, which is a report of a deletion rather
   * than a chance to undo one. Review renders them as rows the user can promote
   * to a step or ignore (#220), so they are carried whole and are not also
   * duplicated into `warnings`.
   */
  unparsed: string[]
  warnings: string[]
}

// ============================================================================
// Action Verbs for Process Step Extraction
// ============================================================================

/**
 * Common action verbs used in business processes
 * Organized by category for better team assignment
 */
const ACTION_VERBS = {
  // Customer-facing / Sales
  sales: [
    'receive', 'contact', 'call', 'email', 'meet', 'present', 'pitch', 
    'quote', 'negotiate', 'close', 'onboard', 'welcome'
  ],
  
  // Operations / Processing
  operations: [
    'process', 'review', 'validate', 'verify', 'check', 'assess', 'analyze',
    'create', 'generate', 'build', 'prepare', 'compile', 'assemble',
    'update', 'modify', 'edit', 'revise', 'correct', 'fix'
  ],
  
  // Support / Service
  support: [
    'respond', 'answer', 'resolve', 'handle', 'assist', 'help', 'support',
    'troubleshoot', 'investigate', 'escalate', 'follow up', 'monitor'
  ],
  
  // General / Administrative
  general: [
    'send', 'submit', 'forward', 'transfer', 'deliver', 'distribute',
    'approve', 'reject', 'confirm', 'notify', 'inform', 'communicate',
    'schedule', 'coordinate', 'organize', 'plan', 'track', 'record',
    'file', 'archive', 'store', 'retrieve', 'search', 'lookup'
  ]
}

// All verbs flattened for general matching
const ALL_VERBS = new Set([
  ...ACTION_VERBS.sales,
  ...ACTION_VERBS.operations,
  ...ACTION_VERBS.support,
  ...ACTION_VERBS.general
])

/**
 * Numbered-list markers: `1.`, `1)`, `1:` and `Step 1:`.
 *
 * At most two digits, and never followed by another number — the `(?!\s*\d)`
 * sits immediately after the punctuation rather than after `\s*`, because a
 * trailing `\s*(?!\d)` backtracks to zero width and reads `Meet at 1: 30 pm`
 * as a marker. The cost is that a list item beginning with a digit
 * (`1. 3 forms are needed`) no longer splits, which is the safer miss.
 */
const LIST_MARKER = /(?:^|\s)(?:step\s+)?(\d{1,2})\s*[.):](?!\s*\d)\s*/gi

/**
 * Where one sentence ends and the next begins: a run of `.!?` that is followed
 * by whitespace or ends the text, or a newline.
 *
 * The whitespace is what separates a sentence end from a decimal point. Splitting
 * on a bare `[.!?]` turns `Send form 1.5 to procurement` into `Send form 1` plus
 * a `5 to procurement` fragment, so the user's line becomes two steps, neither of
 * which they wrote.
 */
const SENTENCE_BREAK = /[.!?]+(?=\s)|[.!?]+$|\n+/

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Parse SIPOC data into process steps with smart linking
 * 
 * @param sipocData - Raw SIPOC wizard data
 * @param teams - Available teams for assignment
 * @param milestoneId - Milestone to assign steps to
 * @returns Parsed steps with gap detection
 */
export function parseSipocData(
  sipocData: SipocData,
  teams: Team[]
): ParseResult {
  const result: ParseResult = {
    steps: [],
    gaps: [],
    unparsed: [],
    warnings: []
  }

  // Extract action phrases from process description
  const { phrases: actionPhrases, unparsed } = extractActionPhrases(
    sipocData.processDescription
  )

  // Carried whole rather than summarised into a warning: Review shows each one
  // as a row that can become a step or be ignored, so the sentence itself is
  // what the caller needs, not a sentence about it.
  result.unparsed = unparsed

  if (actionPhrases.length === 0) {
    result.warnings.push('No clear action steps found in process description')
    // Create a single generic step as fallback. Leave it unowned — the prose
    // named nobody, so Review must confirm and resolve Unassigned, not invent
    // teams[0] here.
    result.steps.push({
      label: sipocData.processDescription.slice(0, 50) + '...',
      suppliers: sipocData.suppliers,
      inputs: sipocData.inputs,
      outputs: sipocData.outputs,
      customers: sipocData.customers,
      teamId: undefined,
      source: sipocData.processDescription,
      // 1-based, like every other `order` in the app. The inline editor rejects
      // 0 as "Order must be a positive number", so a wizard-created step used to
      // display a `#` its own editor refused (#299).
      order: 1
    })
    return result
  }

  // Every phrase becomes a step. The old five-step cap silently discarded the
  // sixth onward, then #216 made it name what it cut — but a named deletion is
  // still a deletion. Review shows the whole list with its count before anything
  // is written, so there is nothing left for a cap to protect against (#220).
  actionPhrases.forEach((phrase, index) => {
    const step: ParsedStep = {
      label: phrase.text,
      suppliers: index === 0 ? sipocData.suppliers : [], // First step gets suppliers
      inputs: [],
      outputs: [],
      customers: index === actionPhrases.length - 1 ? sipocData.customers : [], // Last step gets customers
      source: phrase.source,
      order: index + 1
    }

    // An owner the sentence named beats a guess from its verb; an owner it named
    // that this project has no team for beats both, and stays unresolved so
    // Review can ask.
    const owned = phrase.ownerHint ? matchTeamByName(teams, phrase.ownerHint) : undefined
    if (owned) {
      step.teamId = owned
    } else if (phrase.ownerHint) {
      step.ownerHint = phrase.ownerHint
    } else {
      step.teamId = suggestTeamForStep(phrase.text, teams)
    }

    result.steps.push(step)
  })

  // Distribute SIPOC inputs/outputs across steps
  distributeInputsOutputs(result.steps, sipocData)

  // Apply smart linking (output N → input N+1)
  applySmartLinking(result.steps, result)

  // Detect gaps
  detectGaps(result.steps, result)

  return result
}

// ============================================================================
// Step 1: Extract Action Phrases
// ============================================================================

/**
 * Split a numbered list into its items and whatever prose was written ahead of
 * it, or return `null` when the text is not a list.
 *
 * A split only happens when the markers read 1, 2, 3, … in order. Anything else
 * is prose that happens to contain a number — `Approve invoices over 50. Then
 * archive.` would otherwise lose the `50` and split into two bogus steps.
 *
 * The preamble is kept apart from the items because only the items carry a
 * boundary the user drew. Lead-in prose is inferred like any other sentence, so
 * `Our P2P flow.\n1. …` does not turn its own title into a step (#313).
 */
function splitNumberedList(
  text: string
): { preamble: string | null; items: string[] } | null {
  const markers = [...text.matchAll(LIST_MARKER)]
  if (markers.length === 0) return null
  if (markers.some((m, i) => Number(m[1]) !== i + 1)) return null

  // Reading 1, 2, 3 in order is not enough on its own: `Review tier 1. Escalate
  // to tier 2.` does too, and splitting it would strip both numbers out of the
  // labels. A real list also *starts* somewhere — the text, a line, a colon
  // lead-in, or the end of a sentence.
  if (!/(^|[\n:.!?])\s*$/.test(text.slice(0, markers[0].index))) return null

  const items = markers.map((marker, i) => {
    const start = (marker.index ?? 0) + marker[0].length
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length
    return text.slice(start, end)
  })

  // A clause ending in a colon introduces the list rather than being an item of
  // it, and "The process is as follows:" would otherwise become a step of its
  // own — `process` is an action verb. Anything before that clause is ordinary
  // prose and is kept, so a real step written ahead of the list survives.
  const preamble = text
    .slice(0, markers[0].index)
    .replace(/(^|[.!?\n])[^.!?\n]*:\s*$/, '$1')
    .trim()

  return { preamble: preamble || null, items }
}

/** A run of text, and whether the user drew its boundary or the parser did. */
interface PhraseBlock {
  text: string
  declared: boolean
}

/** One step's worth of extracted text, before it becomes a `ParsedStep`. */
interface ActionPhrase {
  text: string
  /** The subject the sentence put in front of its verb, when it named one. */
  ownerHint?: string
  /** The sentence the phrase was cut from, for quoting back in Review. */
  source: string
}

/**
 * Cut the description into blocks, recording who decided where each one ends.
 *
 * Numbering the steps, or writing one per line, declares the boundaries. Free
 * prose does not, and the parser has to infer them — which is the only case
 * where discarding a run of text is defensible at all.
 */
function splitIntoBlocks(cleaned: string): PhraseBlock[] {
  const list = splitNumberedList(cleaned)
  if (list) {
    return [
      ...(list.preamble ? [{ text: list.preamble, declared: false }] : []),
      ...list.items.map(text => ({ text, declared: true })),
    ]
  }

  const lines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  // One line per step, not merely "contains a newline". A wrapped paste of
  // ordinary paragraphs is multi-line too, and treating its sentences as the
  // user's own boundaries would exempt every verbless one from the unparsed
  // report. A line carrying a sentence break inside it is prose.
  //
  // The break has to be followed by whitespace. Matching any character instead
  // reads the decimal in `Send form 1.5 to procurement` as a sentence end, and
  // because one prose line demotes the whole paste, its siblings lose their
  // declared status and go unparsed — the very bug this fixes, by a side door.
  const oneStepPerLine =
    lines.length > 1 && lines.every(line => !/[.!?]\s/.test(line))
  if (oneStepPerLine) return lines.map(text => ({ text, declared: true }))

  return [{ text: cleaned, declared: false }]
}

/** Sentence case, truncated to something a grid cell can show. */
function formatPhrase(phrase: string): string {
  const formatted = phrase.charAt(0).toUpperCase() + phrase.slice(1)
  return formatted.length > 60 ? formatted.slice(0, 57) + '...' : formatted
}

/** Strip surrounding punctuation so `review,` still matches the verb `review`. */
function bareWord(word: string): string {
  return word.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '')
}

/**
 * The base forms a word could be the third-person singular of, itself included.
 *
 * Process prose is written in the third person — "Procurement validates the
 * coding", "The budget holder approves the spend" — and the vocabulary lists
 * base forms only, so an exact match read every one of those as verbless and
 * sent the whole sentence to `unparsed`. That also made the owner in front of
 * the verb unreachable, since there was no verb to sit in front of (#220).
 *
 * Deliberately only the third person: `-ed` and `-ing` would turn the passive
 * "the invoice is filed" into a step labelled "Filed", which is a worse answer
 * than reporting the sentence as unread.
 */
function verbCandidates(word: string): string[] {
  const forms = [word]
  if (word.endsWith('ies')) forms.push(word.slice(0, -3) + 'y')
  if (word.endsWith('es')) forms.push(word.slice(0, -2))
  if (word.endsWith('s')) forms.push(word.slice(0, -1))
  return forms
}

/**
 * Index of the earliest word in the sentence that begins an action verb, or
 * `-1`.
 *
 * The old scan walked `ALL_VERBS` and took the first *set member* found
 * anywhere in the sentence, so `Send the invoice after we review it` started
 * its label at `review` — `review` sits in the operations list, ahead of `send`
 * in the general list. Position in the sentence decides now (#216).
 */
function findVerbIndex(words: string[]): number {
  const bare = words.map(bareWord)

  for (let i = 0; i < bare.length; i++) {
    const heads = verbCandidates(bare[i])
    for (const verb of ALL_VERBS) {
      const verbWords = verb.split(/\s+/)
      // Only the head of a multi-word verb inflects: `follows up`, never
      // `follow ups`.
      const headMatches = heads.includes(verbWords[0])
      if (
        headMatches &&
        verbWords.every((word, offset) => offset === 0 || bare[i + offset] === word)
      ) {
        return i
      }
    }
  }

  return -1
}

/**
 * Words that stand in front of a verb without naming anyone who could be a team.
 *
 * Pronouns and bare determiners are the common case in process prose ("we send
 * the invoice", "it is filed"), and treating them as owners would offer to
 * create a team called "We".
 */
const NON_OWNER_WORDS = new Set([
  'i', 'we', 'you', 'they', 'he', 'she', 'it', 'this', 'that', 'these', 'those',
  'someone', 'somebody', 'anyone', 'everyone', 'nobody', 'everything', 'nothing',
  'there', 'here', 'then', 'next', 'first', 'finally', 'afterwards', 'also',
])

/** Auxiliaries and adverbs that trail an owner without being part of its name. */
const OWNER_TAIL_WORDS = new Set([
  'will', 'shall', 'must', 'can', 'may', 'should', 'would', 'does', 'do', 'did',
  'then', 'also', 'usually', 'always', 'normally', 'typically', 'immediately',
  'and', 'who', 'that', 'to',
])

const OWNER_LEAD_WORDS = new Set(['the', 'a', 'an', 'our', 'their', 'its', 'my', 'your'])

/**
 * The owner a sentence named, from the words ahead of its verb, or `undefined`.
 *
 * "The budget holder approves the spend" names `budget holder`; "we send the
 * invoice" names nobody. The parser used to discard this half of every sentence
 * outright — it slices the label from the verb onward — which is why nothing
 * downstream could ever say whose step it was (#220).
 */
function extractOwnerHint(words: string[]): string | undefined {
  const bare = words.map(bareWord).filter(word => word.length > 0)

  let start = 0
  while (start < bare.length && OWNER_LEAD_WORDS.has(bare[start])) start++

  let end = bare.length
  while (end > start && OWNER_TAIL_WORDS.has(bare[end - 1])) end--

  const owner = bare.slice(start, end)
  if (owner.length === 0 || owner.length > 4) return undefined
  if (owner.some(word => NON_OWNER_WORDS.has(word))) return undefined

  return owner.join(' ')
}

/**
 * Extract action-oriented phrases from process description
 * Uses simple NLP: look for sentences with action verbs
 *
 * Verb detection trims prose down to its action — `The manager will follow up`
 * becomes `Follow up`. It used to double as a filter, so anything outside a
 * closed ~60-word vocabulary was `continue`d away with nothing on screen:
 * `Manager Approval` missed because only `approve` is listed, and `Pay Invoice`
 * because `pay` is listed nowhere (#313). Where the user drew the boundary there
 * is nothing to trim to and nothing to second-guess, so the item is kept whole;
 * where the parser guessed, a phrase it cannot read is returned in `unparsed`
 * rather than dropped.
 *
 * Each phrase also carries the subject that stood in front of its verb, which
 * is the only place a sentence ever names who does the work.
 */
function extractActionPhrases(description: string): {
  phrases: ActionPhrase[]
  unparsed: string[]
} {
  const phrases: ActionPhrase[] = []
  const unparsed: string[] = []

  // Collapse runs of spaces and tabs but keep newlines. The old normalisation
  // ran `\s+ → ' '` before `\n+ → '. '`, and `\s` includes `\n`, so every
  // newline was gone before the newline rule could fire: multi-line and
  // single-line input parsed identically (#216).
  const cleaned = description.trim().replace(/[^\S\n]+/g, ' ')

  // The numbered-list split runs on the whole description, before the newline
  // split, so a list written one item per line does not leave a stray `2.` at
  // the head of its second label.
  const blocks = splitIntoBlocks(cleaned)

  for (const block of blocks) {
    // A sentence carved out of a declared item is still declared: the boundary
    // the user drew was around the whole item, so a period inside it is no
    // licence to discard half of what they typed.
    const sentences = block.text
      .split(SENTENCE_BREAK)
      .map(s => s.trim())
      .filter(s => s.length > 0)

    for (const sentence of sentences) {
      const words = sentence.toLowerCase().split(/\s+/)
      const verbIndex = findVerbIndex(words)

      if (verbIndex === -1 && !block.declared) {
        unparsed.push(formatPhrase(words.join(' ')))
        continue
      }

      // Extract phrase starting from verb, or the whole item when there is none.
      // The words in front of the verb are the sentence's subject, and they are
      // the only place an owner is ever written.
      phrases.push({
        text: formatPhrase(words.slice(Math.max(verbIndex, 0)).join(' ')),
        ownerHint: verbIndex > 0 ? extractOwnerHint(words.slice(0, verbIndex)) : undefined,
        source: sentence,
      })
    }
  }

  return { phrases, unparsed }
}

// ============================================================================
// Step 2: Team Assignment
// ============================================================================

/**
 * Suggest a team for a step based on its verb category
 */
function suggestTeamForStep(stepLabel: string, teams: Team[]): string | undefined {
  const lowerLabel = stepLabel.toLowerCase()

  // Check each category
  for (const verb of ACTION_VERBS.sales) {
    if (lowerLabel.includes(verb)) {
      return findTeamByName(teams, ['sales', 'customer'])
    }
  }

  for (const verb of ACTION_VERBS.operations) {
    if (lowerLabel.includes(verb)) {
      return findTeamByName(teams, ['operations', 'ops', 'processing'])
    }
  }

  for (const verb of ACTION_VERBS.support) {
    if (lowerLabel.includes(verb)) {
      return findTeamByName(teams, ['support', 'service', 'help'])
    }
  }

  return undefined
}

/**
 * The id of the team whose name the owner hint names, or `undefined`.
 *
 * Matched both ways round so `budget holder` finds a "Budget Holders" team and
 * `finance` finds "Finance". A miss is the interesting case: it is what Review
 * turns into "create it as a team" rather than quietly filing the step under
 * whichever team happened to be first.
 */
function matchTeamByName(teams: Team[], ownerHint: string): string | undefined {
  const hint = ownerHint.toLowerCase().trim()
  if (!hint) return undefined

  const exact = teams.find(team => team.name.toLowerCase() === hint)
  if (exact) return exact.id

  return teams.find(team => {
    const name = team.name.toLowerCase()
    return name.includes(hint) || hint.includes(name)
  })?.id
}

/**
 * Find team by partial name match
 */
function findTeamByName(teams: Team[], keywords: string[]): string | undefined {
  for (const keyword of keywords) {
    const match = teams.find(t => t.name.toLowerCase().includes(keyword))
    if (match) return match.id
  }
  return undefined
}

// ============================================================================
// Step 3: Distribute Inputs/Outputs
// ============================================================================

/**
 * Distribute SIPOC inputs and outputs across the generated steps
 * - First step gets initial inputs
 * - Last step gets final outputs
 * - Middle steps get intermediate inputs/outputs
 */
function distributeInputsOutputs(
  steps: ParsedStep[],
  sipocData: SipocData
): void {
  if (steps.length === 0) return

  const firstStep = steps[0]
  const lastStep = steps[steps.length - 1]

  // First step: assign all inputs from SIPOC
  firstStep.inputs = [...sipocData.inputs]

  // Last step: assign all outputs from SIPOC
  lastStep.outputs = [...sipocData.outputs]

  // Middle steps: try to infer intermediate inputs/outputs
  if (steps.length > 2) {
    for (let i = 1; i < steps.length - 1; i++) {
      // Create generic intermediate outputs based on step label
      const step = steps[i]
      const genericOutput = inferOutputFromLabel(step.label)
      if (genericOutput) {
        step.outputs.push(genericOutput)
      }
    }
  }
}

/**
 * Infer a reasonable output name from step label
 * e.g., "Review application" → "Reviewed application"
 */
function inferOutputFromLabel(label: string): string {
  const lowerLabel = label.toLowerCase()

  // Common transformations
  if (lowerLabel.startsWith('review')) {
    return label.replace(/^review/i, 'Reviewed')
  }
  if (lowerLabel.startsWith('create')) {
    return label.replace(/^create/i, 'Created')
  }
  if (lowerLabel.startsWith('process')) {
    return label.replace(/^process/i, 'Processed')
  }
  if (lowerLabel.startsWith('verify')) {
    return label.replace(/^verify/i, 'Verified')
  }
  if (lowerLabel.startsWith('send')) {
    return label.replace(/^send/i, 'Sent')
  }
  if (lowerLabel.startsWith('approve')) {
    return label.replace(/^approve/i, 'Approved')
  }

  // Generic fallback: add "Completed" prefix
  return `Completed: ${label}`
}

// ============================================================================
// Step 4: Smart Linking
// ============================================================================

/**
 * Auto-link steps: output of Step N becomes input of Step N+1
 * This creates a natural flow through the process
 */
function applySmartLinking(steps: ParsedStep[], result: ParseResult): void {
  for (let i = 0; i < steps.length - 1; i++) {
    const currentStep = steps[i]
    const nextStep = steps[i + 1]

    // If current step has outputs, link them to next step's inputs
    if (currentStep.outputs.length > 0) {
      // Add current outputs as inputs to next step
      for (const output of currentStep.outputs) {
        if (!nextStep.inputs.includes(output)) {
          nextStep.inputs.push(output)
        }
      }
    } else {
      // No output defined - flag as potential gap
      result.warnings.push(
        `Step ${i + 1} ("${currentStep.label}") has no outputs defined - may need manual linking`
      )
    }
  }
}

// ============================================================================
// Step 5: Gap Detection
// ============================================================================

/**
 * Detect potential gaps in the process flow
 * - Missing inputs/outputs
 * - Disconnected steps
 * - Unassigned teams
 */
function detectGaps(steps: ParsedStep[], result: ParseResult): void {
  steps.forEach((step, index) => {
    // Gap: Step has no inputs (except first step)
    if (index > 0 && step.inputs.length === 0) {
      result.gaps.push({
        type: 'input',
        description: `Step ${index + 1} ("${step.label}") has no inputs defined`,
        relatedSteps: [index]
      })
    }

    // Gap: Step has no outputs (except last step)
    if (index < steps.length - 1 && step.outputs.length === 0) {
      result.gaps.push({
        type: 'output',
        description: `Step ${index + 1} ("${step.label}") has no outputs defined`,
        relatedSteps: [index]
      })
    }

    // Gap: Step has no team assigned
    if (!step.teamId) {
      result.gaps.push({
        type: 'process',
        description: `Step ${index + 1} ("${step.label}") has no team assigned`,
        relatedSteps: [index]
      })
    }

    // Gap: Check for mismatches between steps
    if (index < steps.length - 1) {
      const nextStep = steps[index + 1]
      const hasMatchingLink = step.outputs.some(output =>
        nextStep.inputs.includes(output)
      )

      if (step.outputs.length > 0 && nextStep.inputs.length > 0 && !hasMatchingLink) {
        result.gaps.push({
          type: 'process',
          description: `Output of Step ${index + 1} doesn't match input of Step ${index + 2}`,
          relatedSteps: [index, index + 1]
        })
      }
    }
  })
}

// ============================================================================
// Helper: Convert ParsedStep to Step (for database)
// ============================================================================

/**
 * Convert ParsedStep to full Step object for database insertion
 */
export function parsedStepToStep(
  parsed: ParsedStep,
  projectId: string,
  milestoneId: string
): Omit<Step, 'id'> {
  // ZIP-381: an empty teamId used to leak silently here via `|| ''`, producing
  // rows that fail Zod row validation on read. Fail loudly so callers always
  // resolve a real team (or the project's sentinel "Unassigned" team) first.
  if (!parsed.teamId) {
    throw new Error(
      'parsedStepToStep: parsed.teamId is required — caller must resolve a team before persisting'
    )
  }
  const now = Date.now()

  return {
    projectId,
    milestoneId,
    teamId: parsed.teamId,
    label: parsed.label,
    order: parsed.order,
    suppliers: parsed.suppliers,
    inputs: parsed.inputs,
    outputs: parsed.outputs,
    customers: parsed.customers,
    systems: [],
    trigger: undefined,
    result: undefined,
    kpi: undefined,
    decision: false,
    branches: undefined,
    notes: undefined,
    comments: [],
    links: [],
    gapIds: [],
    diagramPosition: undefined,
    createdAt: now,
    updatedAt: now
  }
}
