/**
 * The laid-out diagram for each project, for the session (#281).
 *
 * DiagramCanvas unmounts when the board leaves the Diagram tab, and the layout
 * it just computed used to die with it. Coming back showed Generate Diagram
 * again, and the canvas export lost the viewport it rasterises. This store
 * keeps that layout so the next mount draws the same diagram.
 *
 * It does not survive a restart, and it does not write `steps.diagram_position`.
 * Layout is derived from the steps, teams and milestones. A stored position
 * would only record a drag, and a drag is session state in the same way a
 * folded milestone is. Persisting either is a separate change.
 */
import { create } from 'zustand'
import type { Edge, Node } from 'reactflow'
import type { SwimlaneLayout } from '../lib/layout'
import type { Gap, Milestone, Step, System, Team } from '../data/types'

export interface DiagramView {
  nodes: Node[]
  edges: Edge[]
  swimlanes: SwimlaneLayout[]
  collapsedMilestoneIds: string[]
  /** Identity of the inputs that produced this layout. A mismatch means regenerate. */
  signature: string
}

interface DiagramViewState {
  views: Record<string, DiagramView>
  remember: (projectId: string, view: DiagramView) => void
  clear: (projectId?: string) => void
}

/**
 * Enough of the process that a change would draw a different diagram.
 * `updatedAt` covers a field edit; order, team and milestone cover a move
 * that a forgotten timestamp would miss; the label is the text on the node.
 */
export function diagramInputSignature(input: {
  steps: readonly Pick<Step, 'id' | 'updatedAt' | 'order' | 'milestoneId' | 'teamId' | 'label' | 'decision'>[]
  milestones: readonly Pick<Milestone, 'id' | 'updatedAt' | 'order' | 'name'>[]
  teams: readonly Pick<Team, 'id' | 'order' | 'name' | 'color'>[]
  systems: readonly Pick<System, 'id' | 'name'>[]
  gaps: readonly Pick<Gap, 'id' | 'updatedAt' | 'stepId'>[]
  collapsedMilestoneIds: ReadonlySet<string>
}): string {
  const join = (parts: string[]) => parts.sort().join(',')
  const key = (parts: Array<string | number | boolean | undefined>) => parts.join(':')
  return [
    join(input.steps.map(step => key([
      step.id, step.updatedAt, step.order, step.milestoneId, step.teamId, step.label, step.decision ? 1 : 0,
    ]))),
    join(input.milestones.map(milestone => key([
      milestone.id, milestone.updatedAt, milestone.order, milestone.name,
    ]))),
    join(input.teams.map(team => key([team.id, team.order, team.name, team.color]))),
    join(input.systems.map(system => `${system.id}:${system.name}`)),
    join(input.gaps.map(gap => `${gap.id}:${gap.updatedAt}:${gap.stepId ?? ''}`)),
    join([...input.collapsedMilestoneIds]),
  ].join('|')
}

export const useDiagramView = create<DiagramViewState>((set) => ({
  views: {},
  remember: (projectId, view) =>
    set(state => ({ views: { ...state.views, [projectId]: view } })),
  clear: projectId =>
    set(state => {
      if (!projectId) return { views: {} }
      const views = { ...state.views }
      delete views[projectId]
      return { views }
    }),
}))
