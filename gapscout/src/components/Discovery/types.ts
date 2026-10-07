import type { Step } from '../../data/types'

export type EditableStep = Step & {
  _isNew?: boolean
  _isEditing?: boolean
  _closingGapId?: string
}
