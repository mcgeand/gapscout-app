import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { createGap, getGap } = vi.hoisted(() => ({
  createGap: vi.fn(),
  getGap: vi.fn(),
}))

vi.mock('../services/db', () => ({
  createGap,
  getGap,
  updateGap: vi.fn(),
  updateStep: vi.fn(),
  deleteGap: vi.fn(),
  listGaps: vi.fn().mockResolvedValue([]),
  listGapsByStep: vi.fn().mockResolvedValue([]),
  listSteps: vi.fn().mockResolvedValue([]),
  listTeams: vi.fn().mockResolvedValue([]),
  listMilestones: vi.fn().mockResolvedValue([]),
}))

import GapForm from '../components/Gaps/GapForm'
import { useStepsStore } from '../state/stepsStore'
import { useTeamsStore } from '../state/teamsStore'
import { useGapsStore } from '../state/gapsStore'

beforeEach(() => {
  vi.clearAllMocks()
  createGap.mockResolvedValue('new-gap')
  getGap.mockResolvedValue({
    id: 'new-gap', projectId: 'route-project', observed: 'Observed', expected: 'Expected',
    severity: 'M', status: 'Open', links: [], createdAt: 1, updatedAt: 1,
  })
  useStepsStore.setState({
    steps: [{
      id: 'step-1', projectId: 'route-project', label: 'Step', teamId: 'team', milestoneId: 'milestone', order: 1,
      suppliers: [], inputs: [], outputs: ['output'], customers: ['customer'], systems: [], comments: [], links: [], gapIds: [], createdAt: 1, updatedAt: 1,
    }],
    currentProjectId: 'different-project', isLoading: false,
  })
  useTeamsStore.setState({ teams: [], currentProjectId: 'different-project', isLoading: false })
  useGapsStore.setState({ gaps: [], currentProjectId: 'different-project', isLoading: false })
})

describe('route-owned write identity', () => {
  it('creates a gap with the explicit route projectId, not the lagging steps store project', async () => {
    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        mode="create"
        projectId="route-project"
        prefilledStepId="step-1"
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('What do we currently see? What is the problem?'), { target: { value: 'Observed' } })
    fireEvent.change(screen.getByPlaceholderText('What should we see? What is the ideal outcome?'), { target: { value: 'Expected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save gap' }))

    await waitFor(() => expect(createGap).toHaveBeenCalledOnce())
    expect(createGap.mock.calls[0]?.[0]).toMatchObject({ projectId: 'route-project' })
  })
})
