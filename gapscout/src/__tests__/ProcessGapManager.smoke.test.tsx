import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ProcessGapManager } from '../components/Discovery/ProcessGapManager'

describe('ProcessGapManager — smoke', () => {
  it('renders nothing when no formState and no editingGap', () => {
    const { container } = render(
      <ProcessGapManager
        projectId="project-1"
        formState={null}
        editingGap={null}
        onClose={vi.fn()}
        displayNumbers={null}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
