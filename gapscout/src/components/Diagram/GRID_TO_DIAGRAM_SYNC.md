# Grid → Diagram Sync

**Ticket:** ZIP-94  
**Reference:** PRD Section 4.6 - Bidirectional Editing

## Overview

Changes in the Discovery Grid automatically update the process diagram through the `stepsStore`. The diagram intelligently regenerates with debouncing to prevent layout thrashing.

## Architecture

```
┌──────────────┐         ┌─────────────┐         ┌─────────────┐
│  Discovery   │────────►│  stepsStore │────────►│  Diagram    │
│  Grid        │ update  │   (Zustand) │ notify  │  Canvas     │
└──────────────┘         └─────────────┘         └─────────────┘
                               │                        │
                               ▼                        ▼
                         SQLite Database        Auto-regenerate
                                                  (300ms debounce)
```

## Implementation Details

### 1. Discovery Grid Changes

**File:** `src/components/Discovery/DiscoveryGrid.tsx`

**Before (❌ Broken Sync):**
```typescript
// Direct DB call - doesn't notify subscribers!
await updateStep(step.id, updates)
setSteps(updatedSteps) // Only local state
```

**After (✅ Working Sync):**
```typescript
// Use store - notifies all subscribers including diagram
await updateStepInStore(step.id, updates)
// Local state syncs via useEffect
```

**Key Changes:**
1. Import `useStepsStore` hook
2. Use `stepsStore.updateStep()` instead of direct DB calls
3. Use `stepsStore.deleteStep()` for deletions
4. Subscribe to `stepsStore.steps` to keep local UI in sync
5. Preserve local UI flags (`_isNew`, `_isEditing`) when syncing

**Code:**
```typescript
const { 
  steps: storeSteps, 
  updateStep: updateStepInStore,
  deleteStep: deleteStepFromStore 
} = useStepsStore()

// Sync local state with store
useEffect(() => {
  if (storeSteps.length > 0) {
    // Preserve local UI flags when syncing
    setSteps(prev => {
      const uiFlags = new Map(prev.map(s => 
        [s.id, { _isNew: s._isNew, _isEditing: s._isEditing }]
      ))
      return storeSteps.map(s => ({
        ...s,
        ...uiFlags.get(s.id),
      }))
    })
  }
}, [storeSteps])
```

### 2. Diagram Auto-Regeneration

**File:** `src/components/Diagram/DiagramCanvas.tsx`

**Debounced Regeneration:**
```typescript
useEffect(() => {
  if (hasGenerated && !isGenerating) {
    // Clear existing timer
    if (regenerateTimerRef.current) {
      clearTimeout(regenerateTimerRef.current)
    }

    // Set new timer - regenerate after 300ms of no changes
    regenerateTimerRef.current = setTimeout(() => {
      console.log('Data changed, regenerating diagram...')
      generateDiagram()
    }, 300)
  }

  // Cleanup
  return () => {
    if (regenerateTimerRef.current) {
      clearTimeout(regenerateTimerRef.current)
    }
  }
}, [steps, milestones, teams, hasGenerated, isGenerating, generateDiagram])
```

**Why 300ms?**
- Fast enough to feel instant (< 500ms threshold)
- Long enough to batch rapid edits (e.g., typing in cells)
- Prevents layout thrashing during bulk operations

### 3. stepsStore Implementation

**File:** `src/state/stepsStore.ts`

The store handles:
1. Database writes (`dbUpdateStep()`)
2. Local state updates (`set({ steps: updatedSteps })`)
3. Notifying all subscribers (automatic via Zustand)

```typescript
updateStep: async (stepId: string, data: Partial<Step>) => {
  try {
    await dbUpdateStep(stepId, data)
    
    // Update local state - triggers all subscribers
    const steps = get().steps
    const updatedSteps = steps.map(s => 
      s.id === stepId ? { ...s, ...data } : s
    )
    set({ steps: updatedSteps })
  } catch (error) {
    toast.error('Failed to update step')
  }
}
```

## Data Flow

### Edit Label in Grid

```
1. User edits cell in Discovery Grid
   ↓
2. Debounced save (500ms) → onUpdate callback
   ↓
3. Call stepsStore.updateStep(id, { label: 'New Label' })
   ↓
4. Store updates SQLite database
   ↓
5. Store updates local state: set({ steps: [...] })
   ↓
6. Zustand notifies all subscribers
   ↓
7. DiagramCanvas useEffect triggered (steps changed)
   ↓
8. Debounce timer set (300ms)
   ↓
9. After 300ms: generateDiagram()
   ↓
10. Graph builder: steps → nodes/edges
   ↓
11. ELK layout: position nodes (50-100ms)
   ↓
12. React Flow: render updated diagram
   ↓
Total time: ~1 second from save to diagram update ✅
```

### Change Team (Moves Node to New Lane)

```
1. User selects different team in grid dropdown
   ↓
2. onUpdate({ teamId: 'new-team-id' })
   ↓
3. Store updates database + state
   ↓
4. DiagramCanvas regenerates
   ↓
5. Graph builder assigns new team
   ↓
6. ELK layout: node moves to new swimlane
   ↓
Result: Node appears in different lane ✅
```

### Delete Step

```
1. User selects rows and clicks "Delete"
   ↓
2. For each step: stepsStore.deleteStep(id)
   ↓
3. Store removes from database + state
   ↓
4. DiagramCanvas regenerates
   ↓
5. Graph builder: step not in list
   ↓
6. ELK layout: computes without deleted nodes
   ↓
Result: Nodes removed from diagram ✅
```

## Performance Optimizations

### 1. Debouncing (Grid Edits)

**Grid Cell Editing:**
- Uses `createDebouncedSave()` with 500ms delay
- Prevents DB writes on every keystroke
- Batches rapid edits into single save

### 2. Debouncing (Diagram Regeneration)

**Auto-regeneration:**
- Uses `setTimeout()` with 300ms delay
- Clears previous timers on new changes
- Batches multiple edits into single regeneration

**Example:**
```
Edit label: "Step 1" → "Step 10" (typing)
  0ms: "Step 1"
 50ms: "Step 10" (timer reset)
100ms: "Step 10 (timer reset)
350ms: Regenerate! (300ms after last change)
```

### 3. Smart Regeneration

**Current:** Full regeneration on any change
- Graph builder: O(n) where n = number of steps
- ELK layout: O(n log n) typically 50-100ms for < 50 steps
- React Flow render: O(n) optimized with memoization

**Future Optimization (if needed):**
- Incremental updates for label-only changes
- Selective re-layout when team/milestone changes
- Virtual rendering for large diagrams (> 200 steps)

## User Experience

### Expected Behavior

**Edit Label in Grid:**
1. Type new label
2. Click outside cell (blur)
3. See loading indicator (500ms)
4. Diagram updates (300ms after save)
5. **Total:** < 1 second ✅

**Change Team:**
1. Select new team from dropdown
2. Save immediately (no typing delay)
3. Diagram regenerates (300ms)
4. Node moves to new swimlane
5. **Total:** < 500ms ✅

**Delete Steps:**
1. Select multiple rows
2. Click "Delete" button
3. Confirm dialog
4. Diagram regenerates (300ms)
5. Nodes disappear
6. **Total:** < 500ms ✅

### Response Times

| Action | Grid Update | DB Write | Diagram Regen | Total |
|--------|-------------|----------|---------------|-------|
| Edit label | Immediate | 500ms (debounce) | 300ms (debounce) | ~800ms |
| Change team | Immediate | 0ms | 300ms | ~300ms |
| Delete step | Immediate | 0ms | 300ms | ~300ms |
| Bulk edit (5 steps) | Immediate | 500ms | 300ms | ~800ms |

**All under 1 second! ✅**

## Testing Checklist

- [x] Edit step label in grid → diagram updates
- [x] Change team in grid → node moves to new lane
- [x] Change milestone → diagram regenerates
- [x] Delete step → node removed from diagram
- [x] Bulk delete → all nodes removed
- [x] Rapid edits → debounced (no thrashing)
- [x] Edit SIPOC fields → updates reflected
- [x] Edit systems → badge updates
- [x] Add new step in grid → appears in diagram
- [x] No manual refresh needed ✅
- [x] Build passes (415KB bundle)
- [x] No console errors

## Edge Cases

### 1. New (Unsaved) Steps

**Behavior:** New rows with `_isNew` flag aren't yet in stepsStore
**Handling:** 
- Grid uses `createStep()` on first save
- Then switches to `updateStepInStore()`
- Diagram only shows after creation

### 2. Concurrent Edits

**Scenario:** User edits in both grid and diagram simultaneously
**Handling:**
- Both use same store
- Last write wins (database-level)
- No conflicts (single-user app)

### 3. Rapid Deletions

**Scenario:** Delete 10 steps quickly
**Handling:**
- All deletions process sequentially
- Single regeneration after 300ms
- No layout thrashing

### 4. Empty State

**Scenario:** Delete all steps
**Handling:**
- Store becomes empty array
- Diagram regeneration triggered
- "Generate Diagram" button shown
- No errors

## Troubleshooting

### Grid edits don't update diagram

**Check:**
1. Is `updateStepInStore()` being called? (Console log: "Updated step: ...")
2. Is `stepsStore.steps` changing? (React DevTools)
3. Is `DiagramCanvas` useEffect firing? (Console log: "Data changed, regenerating...")
4. Is `hasGenerated` true? (Must click "Generate Diagram" first)

### Diagram regenerates too frequently

**Possible Causes:**
1. Debounce not working (check timer ref)
2. Effect dependencies causing loops
3. External updates to steps array

**Solution:**
- Verify `regenerateTimerRef` is being set
- Check effect dependencies
- Add more console logs

### Performance issues

**Symptoms:**
- Regeneration takes > 1 second
- UI feels sluggish
- Browser lags

**Solutions:**
1. Check number of steps (> 100?)
2. Increase debounce delay (300ms → 500ms)
3. Profile with React DevTools
4. Consider incremental updates

## Future Enhancements

### Selective Re-layout

Only re-run ELK layout when structural changes occur:

```typescript
const needsLayout = (prevSteps: Step[], newSteps: Step[]) => {
  // Check if team or milestone changed
  return newSteps.some((step, i) => {
    const prev = prevSteps.find(s => s.id === step.id)
    return prev && (
      prev.teamId !== step.teamId ||
      prev.milestoneId !== step.milestoneId
    )
  })
}

// In useEffect:
if (needsLayout(prevSteps, steps)) {
  generateDiagram() // Full regeneration
} else {
  updateNodeData() // Just update labels/badges
}
```

### Real-time Collaboration

For multi-user editing:
1. WebSocket connection
2. Operational Transform (OT) or CRDT
3. Live cursors
4. Conflict resolution

### Undo/Redo

Track changes in a history stack:
```typescript
const [history, setHistory] = useState<Step[][]>([])
const [historyIndex, setHistoryIndex] = useState(0)

const undo = () => {
  const prevSteps = history[historyIndex - 1]
  stepsStore.set({ steps: prevSteps })
}
```

## References

- **PRD Section 4.6:** Bidirectional Editing
- **ZIP-88:** Graph Builder
- **ZIP-89:** Layout Engine
- **ZIP-90:** DiagramCanvas
- **ZIP-93:** Diagram → Grid Sync
- **ZIP-94:** Grid → Diagram Sync (this feature)

