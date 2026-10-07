import { useId } from 'react'
import type { ProjectState } from '../../data/types'

/**
 * ProjectStateControl — whether a map is the process as it runs or the target
 * design (#265).
 *
 * Rendered in both places a project is named: the create wizard, where it
 * defaults to `current` because most maps start as the process you have, and
 * the edit form, where `undefined` shows nothing selected rather than forcing
 * a choice onto a project that predates the field.
 *
 * Native radios in a `radiogroup`, so arrow-key navigation, roving focus and
 * the group's accessible name are the platform's job rather than ours. Each
 * input is visually hidden and paired with a `.seg-face` sibling that draws
 * both the selection and the focus ring — see the `.seg` block in globals.css
 * for why the styling hangs off `input + .seg-face` and not `:has()`.
 */

const OPTIONS: Array<{ value: ProjectState; label: string; hint: string }> = [
  { value: 'current', label: 'Current', hint: 'The process as it runs today' },
  { value: 'future', label: 'Future', hint: 'The target design' },
]

export interface ProjectStateControlProps {
  /** `undefined` means nobody has said; no option draws as selected. */
  value?: ProjectState
  onChange: (value: ProjectState) => void
  /** Distinguishes the radio group when two render on one page. */
  name?: string
  label?: string
}

export function ProjectStateControl({
  value,
  onChange,
  name,
  label = 'Project state',
}: ProjectStateControlProps) {
  const generatedName = useId()
  const labelId = useId()
  const groupName = name ?? generatedName

  return (
    <div>
      <span className="label-field" id={labelId}>
        {label}
      </span>
      <div className="seg" role="radiogroup" aria-labelledby={labelId}>
        {OPTIONS.map((option) => (
          <label key={option.value} className="seg-option" title={option.hint}>
            <input
              type="radio"
              className="sr-only"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="seg-face">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default ProjectStateControl
