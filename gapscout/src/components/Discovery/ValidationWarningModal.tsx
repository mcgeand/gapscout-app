/**
 * Validation Warning Modal
 *
 * Shown when user tries to save a step with missing SIPOC fields.
 * Offers options to:
 * - Go back and complete the fields
 * - Create a gap to track missing fields
 *
 * Reference: ZIP-144 - SIPOC Validation & Auto-Gap Detection
 */

import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Modal } from '../shared/Modal'

interface ValidationWarningModalProps {
  isOpen: boolean
  onClose: () => void
  missingFields: string[]
  onGoBack: () => void
  onCreateGap: () => void
  stepLabel: string
}

export function ValidationWarningModal({
  isOpen,
  onClose,
  missingFields,
  onGoBack,
  onCreateGap,
  stepLabel,
}: ValidationWarningModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Incomplete SIPOC Fields"
      description={
        <>
          Step: <span className="font-medium">{stepLabel}</span>
        </>
      }
      size="md"
      footer={
        <>
          <button onClick={onGoBack} className="btn-secondary inline-flex items-center gap-gs-2">
            <ArrowLeft size={16} strokeWidth={2} />
            Go Back &amp; Edit
          </button>
          <button onClick={onCreateGap} className="btn-primary">
            Create Gap
          </button>
        </>
      }
    >
      <div className="flex items-start gap-gs-3">
        <TriangleAlert
          size={16}
          strokeWidth={2}
          className="text-gs-accent flex-shrink-0 mt-gs-1"
          aria-hidden="true"
        />
        <div className="flex-1 text-[13px] text-gs-ink-muted">
          <p>The following SIPOC fields are missing:</p>
          <ul className="list-disc list-inside my-gs-3 flex flex-col gap-gs-1">
            {missingFields.map((field) => (
              <li key={field} className="capitalize text-gs-ink">
                <strong>{field}</strong>
              </li>
            ))}
          </ul>
          <p>You can either complete these fields now or create a gap to track them for later.</p>
        </div>
      </div>
    </Modal>
  )
}
