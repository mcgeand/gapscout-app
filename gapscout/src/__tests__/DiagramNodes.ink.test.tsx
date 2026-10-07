/**
 * The diagram is ink everywhere except team colour (#212).
 *
 * These assert the two halves of that rule which live in the node components:
 * team colour appears only as the 5px left edge, and no node draws an emoji or a
 * tinted badge. The lane gutter — the other place team colour is allowed — is
 * covered by `buildSwimlaneSvg` in exportDiagram.test.ts.
 *
 * Assertions read *inline* styles rather than computed ones on purpose. Tailwind's
 * sheet is not loaded under jsdom, so `getComputedStyle` would report nothing for a
 * `gs-*` utility and a colour test would pass whatever the class said.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('reactflow', () => ({
  Handle: ({ style }: { style?: Record<string, unknown> }) => (
    <div data-testid="handle" data-background={String(style?.background ?? '')} />
  ),
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}))

import StepNode from '../components/Diagram/StepNode'
import DecisionNode from '../components/Diagram/DecisionNode'
import ProcessEndNode from '../components/Diagram/ProcessEndNode'
import type { NodeProps } from 'reactflow'
import type { ProcessEndNodeData, StepNodeData } from '../lib/graphBuilder'
import type { Step } from '../data/types'

const TEAM_COLOR = '#10B981'
/** jsdom re-serialises a hex in a style attribute, so comparisons use both forms. */
const TEAM_COLOR_RGB = 'rgb(16, 185, 129)'

const makeStep = (overrides: Partial<Step> = {}): Step => ({
  id: 'step-a',
  projectId: 'project-1',
  label: 'Raise purchase requisition',
  teamId: 'team-ops',
  milestoneId: 'milestone-1',
  order: 1,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

const stepData = (overrides: Partial<StepNodeData> = {}): StepNodeData => ({
  label: 'Raise purchase requisition',
  step: makeStep(),
  teamColor: TEAM_COLOR,
  teamName: 'Operations',
  laneId: 'team:team-ops',
  laneOrder: 0,
  column: 0,
  milestoneId: 'milestone-1',
  milestoneName: 'Main Flow',
  gapCount: 0,
  ...overrides,
})

// The components only read `data` and `selected`; the rest of NodeProps is noise.
const nodeProps = <T,>(data: T, selected = false): NodeProps<T> => ({
  data,
  selected,
  id: 'n1',
  type: 'step',
  zIndex: 0,
  isConnectable: true,
  xPos: 0,
  yPos: 0,
  dragging: false,
})

function renderNode(el: ReactNode) {
  const { container } = render(<>{el}</>)
  return container
}

describe('StepNode — ink everywhere except the team edge', () => {
  it('draws an ink border with team colour only on the left edge', () => {
    const container = renderNode(<StepNode {...nodeProps(stepData())} />)
    const node = container.querySelector('.step-node') as HTMLElement

    expect(node.style.borderLeftWidth).toBe('5px')
    expect(node.style.borderLeftColor).toBe(TEAM_COLOR_RGB)
    // The other three sides are ink, and they say so through the token utility
    // rather than a literal, so a token change cannot leave the node behind.
    expect(node.className).toContain('border-gs-ink')
    expect(node.className).toContain('border-2')
  })

  it('spends team colour exactly once in the whole node', () => {
    const container = renderNode(
      <StepNode
        {...nodeProps(stepData({ gapCount: 1, step: makeStep({ systems: ['SAP'] }) }))}
      />
    )

    // Counting, not presence: the handles and the badges all used to take the
    // team's colour too, and each of those would satisfy a presence check.
    const carriesTeamColor = (el: HTMLElement) => {
      const style = el.getAttribute('style') ?? ''
      return (
        style.includes(TEAM_COLOR) ||
        style.includes(TEAM_COLOR_RGB) ||
        el.dataset.background === TEAM_COLOR
      )
    }
    const tinted = Array.from(container.querySelectorAll<HTMLElement>('*')).filter(carriesTeamColor)
    expect(tinted).toHaveLength(1)
  })

  it('flips the border to the accent and tags the corner when the step has gaps', () => {
    const container = renderNode(
      <StepNode {...nodeProps(stepData({ gapCount: 2 }))} />
    )
    const node = container.querySelector('.step-node') as HTMLElement

    expect(node.className).toContain('border-gs-accent')
    expect(node.className).not.toContain('border-gs-ink')
    expect(screen.getByText('2 GAPS')).toBeTruthy()
    // The team edge survives the accent border.
    expect(node.style.borderLeftColor).toBe(TEAM_COLOR_RGB)
  })

  it('says GAP rather than GAPS for a single gap', () => {
    renderNode(<StepNode {...nodeProps(stepData({ gapCount: 1 }))} />)
    expect(screen.getByText('1 GAP')).toBeTruthy()
  })

  it('leaves the border ink and draws no tag when the step has no gaps', () => {
    const container = renderNode(<StepNode {...nodeProps(stepData())} />)
    const node = container.querySelector('.step-node') as HTMLElement

    expect(node.className).toContain('border-gs-ink')
    expect(node.className).not.toContain('border-gs-accent')
    expect(screen.queryByText(/GAPS?$/)).toBeNull()
  })

  it('sets systems as a text meta line, with no icon in the node', () => {
    const container = renderNode(
      <StepNode {...nodeProps(stepData({ step: makeStep({ systems: ['SAP', 'Excel'] }) }))} />
    )

    expect(screen.getByText('SAP · Excel')).toBeTruthy()
    // A glyph in a data cell competes with the data — the node carries no Lucide.
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('keeps the parallel marker clear of the gap tag', () => {
    renderNode(
      <StepNode
        {...nodeProps(stepData({ isParallel: true, gapCount: 1 }))}
      />
    )

    const marker = screen.getByTitle('Parallel step (runs at same time as another step)')
    const tag = screen.getByText('1 GAP')
    // Both are corner-anchored; if they shared a corner one would cover the other.
    expect(marker.className).toContain('-bottom-0.5')
    expect(tag.className).toContain('-top-0.5')
  })
})

describe('DecisionNode', () => {
  it('draws an ink diamond and no team colour', () => {
    const container = renderNode(<DecisionNode {...nodeProps(stepData())} />)
    const diamond = container.querySelector('.decision-node-diamond') as HTMLElement

    expect(diamond.className).toContain('border-gs-ink')
    expect(container.innerHTML).not.toContain(TEAM_COLOR)
    expect(container.innerHTML).not.toContain(TEAM_COLOR_RGB)
  })
})

describe('ProcessEndNode', () => {
  const endData = (overrides: Partial<ProcessEndNodeData> = {}): ProcessEndNodeData => ({
    label: 'Process End',
    entityName: 'NetSuite',
    teamColor: TEAM_COLOR,
    teamName: 'NetSuite',
    laneId: 'name:NetSuite',
    laneOrder: null,
    column: 3,
    isSystem: true,
    ...overrides,
  })

  it('draws no emoji', () => {
    const container = renderNode(<ProcessEndNode {...nodeProps(endData())} />)
    // The 💻/🏁 badge is gone; a dashed ink border is what says "terminal".
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('marks the terminal with a dashed ink border, keeping the team edge', () => {
    const container = renderNode(<ProcessEndNode {...nodeProps(endData())} />)
    const node = container.firstElementChild as HTMLElement

    expect(node.className).toContain('border-dashed')
    expect(node.className).toContain('border-gs-ink')
    expect(node.style.borderLeftColor).toBe(TEAM_COLOR_RGB)
  })

  it('spends team colour exactly once, as it did on the step node', () => {
    const container = renderNode(<ProcessEndNode {...nodeProps(endData())} />)
    // The icon disc and the System/Team badge were both team-filled before #212,
    // and either would satisfy a presence check on the left edge alone.
    const tinted = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const style = el.getAttribute('style') ?? ''
      return (
        style.includes(TEAM_COLOR) ||
        style.includes(TEAM_COLOR_RGB) ||
        el.dataset.background === TEAM_COLOR
      )
    })
    expect(tinted).toHaveLength(1)
  })

  it('names the kind in words rather than a glyph', () => {
    renderNode(<ProcessEndNode {...nodeProps(endData({ isSystem: false }))} />)
    expect(screen.getByText('Team')).toBeTruthy()
  })
})
