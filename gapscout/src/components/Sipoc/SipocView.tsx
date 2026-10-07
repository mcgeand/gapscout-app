/**
 * SIPOC View - Display and edit SIPOC data
 * 
 * Shows the 5 SIPOC elements in a clean table format:
 * - Suppliers (Who provides inputs?)
 * - Inputs (What do you need?)
 * - Process (What happens?)
 * - Outputs (What gets produced?)
 * - Customers (Who receives outputs?)
 * 
 * Features:
 * - Edit button to re-open wizard
 * - Export to clipboard (markdown format)
 * - Related policies display
 */

import toast from 'react-hot-toast'
import type { SipocData } from './SipocWizard'
import { EmptyState } from '../shared/EmptyState'

interface SipocViewProps {
  sipocData: SipocData | null
  onEdit: () => void
  relatedPolicies?: string[]
}

export default function SipocView({ sipocData, onEdit, relatedPolicies = [] }: SipocViewProps) {
  const handleExport = async () => {
    if (!sipocData) return

    const markdown = generateMarkdown(sipocData, relatedPolicies)

    try {
      await navigator.clipboard.writeText(markdown)
      toast.success('Copied SIPOC as markdown')
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      toast.error('Failed to copy to clipboard')
    }
  }

  // Empty state
  if (!sipocData) {
    return (
      <EmptyState
        title="No SIPOC data yet"
        message="The SIPOC Wizard walks the five elements in order — Suppliers, Inputs, Process, Outputs, Customers — and writes them back as steps."
        action={
          <button className="btn-primary" onClick={onEdit}>
            Run SIPOC Wizard
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--color-deep-navy)' }}>
            SIPOC Analysis
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Suppliers → Inputs → Process → Outputs → Customers
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn-secondary"
            onClick={handleExport}
            title="Copy SIPOC as markdown"
          >
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Export
          </button>
          <button className="btn-primary" onClick={onEdit}>
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
        </div>
      </div>

      {/* SIPOC Grid */}
      <div className="grid grid-cols-1 gap-6">
        {/* Suppliers */}
        <SipocSection
          title="Suppliers"
          subtitle="Who provides inputs?"
          items={sipocData.suppliers}
          color="blue"
        />

        {/* Inputs */}
        <SipocSection
          title="Inputs"
          subtitle="What do you need to start?"
          items={sipocData.inputs}
          color="green"
        />

        {/* Process */}
        <div className="card">
          <div className="flex items-start gap-3 mb-3">
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-deep-navy)' }}>
                Process
              </h3>
              <p className="text-sm text-gray-600">What happens?</p>
            </div>
            <span className="badge-gray">
              {sipocData.process.length} chars
            </span>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <p className="text-gray-800 whitespace-pre-wrap">{sipocData.process}</p>
          </div>
        </div>

        {/* Outputs */}
        <SipocSection
          title="Outputs"
          subtitle="What gets produced?"
          items={sipocData.outputs}
          color="orange"
        />

        {/* Customers */}
        <SipocSection
          title="Customers"
          subtitle="Who receives outputs?"
          items={sipocData.customers}
          color="purple"
        />

        {/* Related Policies (if any) */}
        {relatedPolicies.length > 0 && (
          <div className="card">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-deep-navy)' }}>
                  Related Policies
                </h3>
                <p className="text-sm text-gray-600">Compliance and governance</p>
              </div>
              <span className="badge-blue">{relatedPolicies.length}</span>
            </div>
            <div className="space-y-2">
              {relatedPolicies.map((policy, idx) => (
                <div
                  key={idx}
                  className="px-3 py-2 bg-blue-50 text-blue-900 rounded-lg text-sm border border-blue-200"
                >
                  {policy}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Helper Components
// ============================================================================

interface SipocSectionProps {
  title: string
  subtitle: string
  items: string[]
  color: 'blue' | 'green' | 'orange' | 'purple'
}

function SipocSection({ title, subtitle, items, color }: SipocSectionProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-900 border-blue-200',
    green: 'bg-green-50 text-green-900 border-green-200',
    orange: 'bg-orange-50 text-orange-900 border-orange-200',
    purple: 'bg-purple-50 text-purple-900 border-purple-200',
  }

  return (
    <div className="card">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-deep-navy)' }}>
            {title}
          </h3>
          <p className="text-sm text-gray-600">{subtitle}</p>
        </div>
        <span className="badge-gray">{items.length}</span>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((item, idx) => (
            <div
              key={idx}
              className={`px-3 py-2 rounded-lg text-sm border ${colorClasses[color]}`}
            >
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-400">
          <p className="text-sm">No {title.toLowerCase()} specified</p>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Markdown Export Helper
// ============================================================================

function generateMarkdown(sipocData: SipocData, relatedPolicies: string[]): string {
  let markdown = '# SIPOC Analysis\n\n'

  // Suppliers
  markdown += '## Suppliers\n\n'
  if (sipocData.suppliers.length > 0) {
    sipocData.suppliers.forEach(s => {
      markdown += `- ${s}\n`
    })
  } else {
    markdown += '*None specified*\n'
  }
  markdown += '\n'

  // Inputs
  markdown += '## Inputs\n\n'
  if (sipocData.inputs.length > 0) {
    sipocData.inputs.forEach(i => {
      markdown += `- ${i}\n`
    })
  } else {
    markdown += '*None specified*\n'
  }
  markdown += '\n'

  // Process
  markdown += '## Process\n\n'
  markdown += sipocData.process || '*No process description provided*'
  markdown += '\n\n'

  // Outputs
  markdown += '## Outputs\n\n'
  if (sipocData.outputs.length > 0) {
    sipocData.outputs.forEach(o => {
      markdown += `- ${o}\n`
    })
  } else {
    markdown += '*None specified*\n'
  }
  markdown += '\n'

  // Customers
  markdown += '## Customers\n\n'
  if (sipocData.customers.length > 0) {
    sipocData.customers.forEach(c => {
      markdown += `- ${c}\n`
    })
  } else {
    markdown += '*None specified*\n'
  }
  markdown += '\n'

  // Related Policies
  if (relatedPolicies.length > 0) {
    markdown += '## Related Policies\n\n'
    relatedPolicies.forEach(p => {
      markdown += `- ${p}\n`
    })
    markdown += '\n'
  }

  // Footer
  markdown += '---\n'
  markdown += `*Generated by GapScout on ${new Date().toLocaleDateString()}*\n`

  return markdown
}

