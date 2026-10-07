import { GapForm } from '../Gaps'
import type { Gap } from '../../data/types'

interface ProcessGapFormState {
  order: number
  milestoneId: string
  displayOrder?: number
}

interface ProcessGapManagerProps {
  projectId: string
  formState: ProcessGapFormState | null
  editingGap: Gap | null
  onClose: () => void | Promise<void>
  /** The grid's own `#` column, so the form names the number on screen (#345). */
  displayNumbers: Map<string, number> | null
}

export function ProcessGapManager({
  projectId,
  formState,
  editingGap,
  onClose,
  displayNumbers,
}: ProcessGapManagerProps) {
  const isOpen = formState !== null || editingGap !== null
  if (!isOpen) return null

  return (
    <GapForm
      isOpen={isOpen}
      onClose={onClose}
      projectId={projectId}
      mode={editingGap ? 'edit' : 'create'}
      gap={editingGap}
      prefilledStepId={null}
      prefilledOrder={editingGap ? undefined : (formState?.order ?? 0)}
      prefilledDisplayOrder={editingGap ? undefined : formState?.displayOrder}
      prefilledMilestoneId={editingGap ? undefined : (formState?.milestoneId ?? '')}
      displayNumbers={displayNumbers}
    />
  )
}
