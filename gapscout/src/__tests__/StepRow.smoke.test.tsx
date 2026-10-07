import { StrictMode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableStep } from '../components/Discovery/types'

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: mockToastError, success: vi.fn() }),
}))

import { StepRow } from '../components/Discovery/StepRow'

const makeStep = (overrides: Partial<EditableStep> = {}): EditableStep => ({
  id: 'step-1',
  projectId: 'project-1',
  label: 'Test Step',
  teamId: 'team-1',
  milestoneId: 'milestone-1',
  order: 1,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
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
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const stepRowElement = (
  step: EditableStep,
  onUpdate: (updates: Partial<EditableStep>) => Promise<void>
) => (
  <StepRow
    step={step}
    index={0}
    allSteps={[step]}
    displayNumber={null}
    previousDisplayNumber={null}
    validationSteps={[step]}
    milestones={[]}
    teams={[]}
    systems={[]}
    isSelected={false}
    onToggleSelect={vi.fn()}
    onUpdate={onUpdate}
  />
)

const renderStepRow = (onUpdate: (updates: Partial<EditableStep>) => Promise<void>) => {
  const step = makeStep()
  return render(
    <table>
      <tbody>{stepRowElement(step, onUpdate)}</tbody>
    </table>
  )
}

describe('StepRow — smoke', () => {
  it('renders a row inside a table without throwing', () => {
    const step = makeStep()
    const { container } = render(
      <table>
        <tbody>
          <StepRow
            step={step}
            index={0}
            allSteps={[step]}
            displayNumber={null}
            previousDisplayNumber={null}
            validationSteps={[step]}
            milestones={[]}
            teams={[]}
            systems={[]}
            isSelected={false}
            onToggleSelect={vi.fn()}
            onUpdate={vi.fn().mockResolvedValue(undefined)}
          />
        </tbody>
      </table>
    )
    expect(container.querySelector('tr')).toBeInTheDocument()
  })

  it('uses the latest onUpdate callback after rerendering before a debounced save', async () => {
    vi.useFakeTimers()
    try {
      const firstOnUpdate = vi.fn().mockResolvedValue(undefined)
      const latestOnUpdate = vi.fn().mockResolvedValue(undefined)
      const view = renderStepRow(firstOnUpdate)

      fireEvent.click(screen.getByText('Test Step'))
      const input = screen.getByPlaceholderText('Enter process step...')
      fireEvent.change(input, { target: { value: 'Updated Step' } })
      fireEvent.blur(input)
      const step = makeStep()
      view.rerender(
        <table>
          <tbody>{stepRowElement(step, latestOnUpdate)}</tbody>
        </table>
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(firstOnUpdate).not.toHaveBeenCalled()
      expect(latestOnUpdate).toHaveBeenCalledWith({ label: 'Updated Step' }, { unattended: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles a fresh rejected autofill update without an unhandled rejection or success', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('save failed'))
    const previousStep = makeStep({ id: 'step-0', order: 1, customers: ['Customer'] })
    const currentStep = makeStep({ id: 'step-1', order: 2 })
    const unhandledRejections: unknown[] = []
    const handleUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', handleUnhandledRejection)

    try {
      render(
        <table>
          <tbody>
            <StepRow
              step={currentStep}
              index={1}
              allSteps={[previousStep, currentStep]}
              displayNumber={null}
              previousDisplayNumber={previousStep.order}
              validationSteps={[previousStep, currentStep]}
              milestones={[]}
              teams={[]}
              systems={[]}
              isSelected={false}
              onToggleSelect={vi.fn()}
              onUpdate={onUpdate}
            />
          </tbody>
        </table>
      )

      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: /Fill from #1/ })[0])
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(onUpdate).toHaveBeenCalledWith({ suppliers: ['Customer'] })
      expect(screen.queryByText('Step saved')).not.toBeInTheDocument()
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', handleUnhandledRejection)
    }
  })

  it('keeps the debounce under StrictMode, whose mount runs the unmount cleanup', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const step = makeStep()
      render(
        <StrictMode>
          <table>
            <tbody>{stepRowElement(step, onUpdate)}</tbody>
          </table>
        </StrictMode>
      )

      fireEvent.click(screen.getByText('Test Step'))
      const input = screen.getByPlaceholderText('Enter process step...')
      fireEvent.change(input, { target: { value: 'Debounced Step' } })
      fireEvent.blur(input)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(onUpdate).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(onUpdate).toHaveBeenCalledWith({ label: 'Debounced Step' }, { unattended: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes a pending edit when the row unmounts', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const view = renderStepRow(onUpdate)

      fireEvent.click(screen.getByText('Test Step'))
      const input = screen.getByPlaceholderText('Enter process step...')
      fireEvent.change(input, { target: { value: 'Switched Tabs Step' } })
      fireEvent.blur(input)
      view.unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).toHaveBeenCalledWith({ label: 'Switched Tabs Step' }, { unattended: true })
      expect(onUpdate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // The combination that ships: main.tsx wraps the app in StrictMode, so a row
  // has already run its cleanup once by the time a real unmount arrives.
  it('writes a pending edit when a StrictMode-mounted row unmounts', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const step = makeStep()
      const view = render(
        <StrictMode>
          <table>
            <tbody>{stepRowElement(step, onUpdate)}</tbody>
          </table>
        </StrictMode>
      )

      fireEvent.click(screen.getByText('Test Step'))
      const input = screen.getByPlaceholderText('Enter process step...')
      fireEvent.change(input, { target: { value: 'Strict Unmount Step' } })
      fireEvent.blur(input)
      view.unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).toHaveBeenCalledWith({ label: 'Strict Unmount Step' }, { unattended: true })
      expect(onUpdate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('StepRow — an open editor at unmount (#256)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Open a cell editor, type, and unmount without ever blurring — the shape of
   * the real bug, where a milestone-tab click in WKWebView leaves the input
   * focused so onBlur never commits. `fireEvent` does not move focus either,
   * which is what makes it reproducible here.
   */
  const typeIntoLabelAndUnmount = async (
    onUpdate: (updates: Partial<EditableStep>) => Promise<void>,
    value: string,
    step: EditableStep = makeStep()
  ) => {
    const view = render(
      <table>
        <tbody>{stepRowElement(step, onUpdate)}</tbody>
      </table>
    )

    fireEvent.click(screen.getByText(step.label))
    fireEvent.change(screen.getByPlaceholderText('Enter process step...'), {
      target: { value },
    })
    view.unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('writes the uncommitted value the editor still holds', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      await typeIntoLabelAndUnmount(onUpdate, 'Never Blurred Step')

      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith(
        { label: 'Never Blurred Step' },
        { unattended: true }
      )
    } finally {
      vi.useRealTimers()
    }
  })

  // main.tsx wraps the app in StrictMode, so the cleanup has already run once —
  // with no editor open — by the time a real unmount arrives.
  it('writes it from a StrictMode-mounted row too', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const step = makeStep()
      const view = render(
        <StrictMode>
          <table>
            <tbody>{stepRowElement(step, onUpdate)}</tbody>
          </table>
        </StrictMode>
      )

      fireEvent.click(screen.getByText('Test Step'))
      fireEvent.change(screen.getByPlaceholderText('Enter process step...'), {
        target: { value: 'Strict Never Blurred Step' },
      })
      view.unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith(
        { label: 'Strict Never Blurred Step' },
        { unattended: true }
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes nothing for an editor opened and closed unchanged', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const step = makeStep()
      const view = render(
        <table>
          <tbody>{stepRowElement(step, onUpdate)}</tbody>
        </table>
      )

      fireEvent.click(screen.getByText('Test Step'))
      view.unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports an unparseable value rather than writing it', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const step = makeStep()
      const view = render(
        <table>
          <tbody>{stepRowElement(step, onUpdate)}</tbody>
        </table>
      )

      fireEvent.click(screen.getByTitle('Click to edit order number'))
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
      view.unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('Order must be a positive number')
    } finally {
      vi.useRealTimers()
    }
  })

  // A new row's editor is reported to the Save tray via onPendingEditChange and
  // persisted by "Save Step" (#171); committing it here as well would write a
  // row the user cancelled.
  it('leaves a new row\'s editor to the Save tray', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      await typeIntoLabelAndUnmount(
        onUpdate,
        'Abandoned New Row',
        makeStep({ _isNew: true })
      )

      expect(onUpdate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('StepRow — an editor left open across a landed write', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // handleStartEdit seeds the editor from the `step` prop, which is still the
  // pre-edit value while a debounced write is in flight. Comparing the editor
  // against the *step* at unmount would call that untouched editor a change and
  // write the pre-edit value back over the edit that just landed.
  it('does not write a stale seed back over the edit it is waiting on', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const step = makeStep()
      const view = render(
        <table>
          <tbody>{stepRowElement(step, onUpdate)}</tbody>
        </table>
      )

      fireEvent.click(screen.getByText('Test Step'))
      const input = screen.getByPlaceholderText('Enter process step...')
      fireEvent.change(input, { target: { value: 'Committed Step' } })
      fireEvent.blur(input)

      // Reopen the same cell inside the 500ms window. The prop has not moved
      // yet, so the editor seeds with the pre-edit label.
      fireEvent.click(screen.getByText('Test Step'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(onUpdate).toHaveBeenCalledWith(
        { label: 'Committed Step' },
        { unattended: false }
      )

      // The write has landed, so the row rerenders with the new label while the
      // editor still shows the old one. Nobody has typed since.
      view.rerender(
        <table>
          <tbody>
            {stepRowElement({ ...step, label: 'Committed Step' }, onUpdate)}
          </tbody>
        </table>
      )
      view.unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // The same reopened editor, this time actually typed into: the seed says the
  // user changed it, so it still has to be written.
  it('writes a reopened editor the user did type into', async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      const step = makeStep()
      const view = render(
        <table>
          <tbody>{stepRowElement(step, onUpdate)}</tbody>
        </table>
      )

      fireEvent.click(screen.getByText('Test Step'))
      fireEvent.blur(screen.getByPlaceholderText('Enter process step...'))
      fireEvent.click(screen.getByText('Test Step'))
      fireEvent.change(screen.getByPlaceholderText('Enter process step...'), {
        target: { value: 'Typed After Reopen' },
      })
      view.unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith(
        { label: 'Typed After Reopen' },
        { unattended: true }
      )
    } finally {
      vi.useRealTimers()
    }
  })

  // flush() returns early while a write is executing; the queue re-arms at 0ms
  // in that write's `finally`, so the second write happens after unmount and
  // has to report itself unattended too.
  it('marks the write that re-arms behind an in-flight one unattended', async () => {
    vi.useFakeTimers()
    try {
      let releaseFirstWrite: () => void = () => {}
      const firstWrite = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve
      })
      const onUpdate = vi
        .fn()
        .mockImplementationOnce(() => firstWrite)
        .mockResolvedValue(undefined)

      const step = makeStep()
      const view = render(
        <table>
          <tbody>{stepRowElement(step, onUpdate)}</tbody>
        </table>
      )

      fireEvent.click(screen.getByText('Test Step'))
      const input = screen.getByPlaceholderText('Enter process step...')
      fireEvent.change(input, { target: { value: 'First' } })
      fireEvent.blur(input)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(onUpdate).toHaveBeenCalledTimes(1)

      // A second editor is open and typed into while the first write hangs.
      // Column 10 is Notes: checkbox, validation, #, milestone, supplier,
      // inputs, process, output, customer, trigger, notes, SIPOC.
      const notesCell = view.container.querySelectorAll('td')[10] as HTMLElement
      fireEvent.click(within(notesCell).getByText('—'))
      const notes = screen.getByPlaceholderText('Additional notes...')
      fireEvent.change(notes, { target: { value: 'Queued behind the write' } })
      view.unmount()

      await act(async () => {
        releaseFirstWrite()
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onUpdate).toHaveBeenCalledTimes(2)
      expect(onUpdate).toHaveBeenLastCalledWith(
        { notes: 'Queued behind the write' },
        { unattended: true }
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('StepRow — the # column in the All Steps view (#299)', () => {
  it('shows the process position, not the stored milestone-scoped order', () => {
    // Pay Invoice is order 1 in the last milestone. Showing the stored 1 in a
    // list sorted by process position reads as a broken sequence.
    const step = makeStep({ id: 'pay-invoice', label: 'Pay Invoice', order: 1 })

    render(
      <table><tbody>
        <StepRow
          step={step}
          index={0}
          allSteps={[step]}
          displayNumber={6}
          previousDisplayNumber={null}
          validationSteps={[step]}
          milestones={[]}
          teams={[]}
          systems={[]}
          isSelected={false}
          onToggleSelect={vi.fn()}
          onUpdate={vi.fn()}
        />
      </tbody></table>
    )

    expect(screen.getByText('6')).toBeTruthy()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('does not open an order editor on a position that is not the stored value', () => {
    // Typing here would write a number outside the milestone's range, or move a
    // step the user was not pointing at. The order is edited from the step's own
    // milestone tab, where the display and the stored value are the same.
    const step = makeStep({ id: 'pay-invoice', label: 'Pay Invoice', order: 1 })
    const onUpdate = vi.fn()

    render(
      <table><tbody>
        <StepRow
          step={step}
          index={0}
          allSteps={[step]}
          displayNumber={6}
          previousDisplayNumber={null}
          validationSteps={[step]}
          milestones={[]}
          teams={[]}
          systems={[]}
          isSelected={false}
          onToggleSelect={vi.fn()}
          onUpdate={onUpdate}
        />
      </tbody></table>
    )

    fireEvent.click(screen.getByText('6'))

    expect(document.querySelector('input[type="number"]')).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('still edits the stored order inside a milestone tab', () => {
    const step = makeStep({ id: 'pay-invoice', label: 'Pay Invoice', order: 1 })

    render(
      <table><tbody>
        <StepRow
          step={step}
          index={0}
          allSteps={[step]}
          displayNumber={null}
          previousDisplayNumber={null}
          validationSteps={[step]}
          milestones={[]}
          teams={[]}
          systems={[]}
          isSelected={false}
          onToggleSelect={vi.fn()}
          onUpdate={vi.fn()}
        />
      </tbody></table>
    )

    fireEvent.click(screen.getByText('1'))

    expect(document.querySelector('input[type="number"]')).not.toBeNull()
  })
})
