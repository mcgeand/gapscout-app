/**
 * Who the app says you are (#208).
 *
 * GapScout is local-first and has no accounts, so this is one hardcoded person
 * — but it used to be three unrelated literals in `Toolbar.tsx`: initials at
 * :58, a name at :72 and a workspace label at :75, none of which knew about the
 * others. Settings (#122) replaces the values here with stored ones; when it
 * does, it changes this file and nothing else.
 */

export const IDENTITY = {
  name: 'Danny McGean',
  /** What the app is scoped to. There is no remote workspace to name. */
  workspace: 'Local Workspace',
}

/** Derived, so a changed name can never disagree with the initials beside it. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return `${first}${last}`.toUpperCase()
}
