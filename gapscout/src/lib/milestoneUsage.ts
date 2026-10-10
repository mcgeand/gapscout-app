/**
 * Wording for what still uses a milestone, shared by the store's refusal toast
 * and the Manage Milestones dialog so the two cannot drift apart.
 *
 * Only the non-zero parts are named: "2 steps", "1 process gap", or
 * "2 steps and 1 process gap".
 */
export interface MilestoneUsageCounts {
  steps: number
  processGaps: number
}

export function isMilestoneInUse(usage: MilestoneUsageCounts): boolean {
  return usage.steps > 0 || usage.processGaps > 0
}

export function describeMilestoneUsage(usage: MilestoneUsageCounts): string {
  const parts: string[] = []
  if (usage.steps > 0) parts.push(`${usage.steps} step${usage.steps === 1 ? '' : 's'}`)
  if (usage.processGaps > 0) {
    parts.push(`${usage.processGaps} process gap${usage.processGaps === 1 ? '' : 's'}`)
  }
  return parts.join(' and ')
}
