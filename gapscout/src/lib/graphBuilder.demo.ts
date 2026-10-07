/**
 * Graph Builder Demo - Manual verification of graph transformation
 * 
 * Run this in the console to see the output:
 * import { demoGraphBuilder } from './lib/graphBuilder.demo'
 * demoGraphBuilder()
 */

import { stepsToNodesEdges } from './graphBuilder'
import type { Step, Milestone, Team } from '../data/types'

// Mock data
const mockTeams: Team[] = [
  {
    id: 'T1',
    projectId: 'P1',
    name: 'Sales',
    color: '#3B82F6',
    description: 'Sales team',
    order: 0,
    tags: [],
    createdAt: Date.now(),
  },
  {
    id: 'T2',
    projectId: 'P1',
    name: 'Operations',
    color: '#F59E0B',
    description: 'Operations team',
    order: 1,
    tags: [],
    createdAt: Date.now(),
  },
]

const mockMilestones: Milestone[] = [
  {
    id: 'M1',
    projectId: 'P1',
    name: 'Request Phase',
    order: 0,
    description: 'Initial request processing',
    relatedPolicies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'M2',
    projectId: 'P1',
    name: 'Fulfillment Phase',
    order: 1,
    description: 'Order fulfillment',
    relatedPolicies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

/** Exported for tests that assert the demo satisfies SIPOC chain rules (#364). */
export const graphBuilderDemoSteps: Step[] = [
  // Request Phase
  {
    id: 'S1',
    projectId: 'P1',
    label: 'Submit purchase request',
    teamId: 'T1',
    milestoneId: 'M1',
    order: 0,
    suppliers: ['Requester'],
    inputs: ['Purchase need'],
    outputs: ['PR form'],
    customers: ['Approver'],
    systems: ['ERP'],
    decision: false,
    notes: '',
    comments: [],
    links: [],
    gapIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'S2',
    projectId: 'P1',
    label: 'Review and approve',
    teamId: 'T2',
    milestoneId: 'M1',
    order: 1,
    suppliers: ['Approver'],
    inputs: ['PR form'],
    outputs: ['Approval decision'],
    customers: ['Ops'],
    systems: ['ERP'],
    decision: true, // This is a decision point
    branches: [
      { when: 'Approved', toStepId: 'S3', label: 'Approved' },
      { when: 'Rejected', toStepId: 'S1', label: 'Rejected - Resubmit' }, // Loop back!
    ],
    notes: '',
    comments: [],
    links: [],
    gapIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  
  // Fulfillment Phase
  {
    id: 'S3',
    projectId: 'P1',
    label: 'Create purchase order',
    teamId: 'T2',
    milestoneId: 'M2',
    order: 0,
    suppliers: ['Approver'],
    inputs: ['Approved PR'],
    outputs: ['PO'],
    customers: ['Vendor'],
    systems: ['ERP'],
    decision: false,
    notes: '',
    comments: [],
    links: [],
    gapIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'S4',
    projectId: 'P1',
    label: 'Send PO to vendor',
    teamId: 'T2',
    milestoneId: 'M2',
    order: 1,
    suppliers: ['Vendor'],
    inputs: ['PO'],
    outputs: ['Sent PO'],
    customers: ['Vendor'],
    systems: ['Email'],
    decision: false,
    notes: '',
    comments: [],
    links: [],
    gapIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

/**
 * Demo function - Run this to see graph transformation output
 */
export function demoGraphBuilder() {
  console.log('🧪 Graph Builder Demo\n')
  console.log('═'.repeat(60))
  
  const result = stepsToNodesEdges(graphBuilderDemoSteps, mockMilestones, mockTeams, [], [])
  
  console.log('\n📊 NODES:')
  console.log('─'.repeat(60))
  result.nodes.forEach(node => {
    console.log(`
  ID: ${node.id}
  Type: ${node.type}
  Label: ${node.data.label}
  Team: ${node.data.teamName} (${node.data.teamColor})
  Milestone: ${node.data.milestoneName}
  Parallel: ${node.data.isParallel || false}
    `)
  })
  
  console.log('\n🔗 EDGES:')
  console.log('─'.repeat(60))
  result.edges.forEach(edge => {
    const label = edge.label ? ` [${edge.label}]` : ''
    console.log(`  ${edge.source} → ${edge.target}${label}`)
  })
  
  console.log('\n═'.repeat(60))
  console.log(`✅ Generated ${result.nodes.length} nodes and ${result.edges.length} edges\n`)
  
  return result
}

// Auto-run demo if this file is executed directly
if (import.meta.env.DEV) {
  // Uncomment to auto-run on import:
  // demoGraphBuilder()
}

