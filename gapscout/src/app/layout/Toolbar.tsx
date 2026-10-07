import { Info } from 'lucide-react'
import SearchBar from '../../components/shared/SearchBar'

interface ToolbarProps {
  onShowHelp?: () => void
}

/**
 * Toolbar - search and help, above a 1px rule.
 *
 * It used to render seven controls, four of them dead: Export had no `onClick`
 * at all (#198), and Settings, Documentation and About were three menu items
 * that did nothing. Dead UI reads as a bug, so they are gone rather than shown
 * broken — Settings comes back with #122, and Export now lives in the board
 * header where it can reach the project it exports (#207).
 *
 * The avatar menu went with them: its only live content was the identity block,
 * which #208 moved to the sidebar footer and sourced from `app/identity.ts`.
 */
export default function Toolbar({ onShowHelp }: ToolbarProps) {
  return (
    <div className="bg-gs-surface border-b border-gs-rule sticky top-0 z-30 w-full">
      <div className="px-gs-4 h-14 flex items-center justify-between gap-gs-4 w-full max-w-none">
        <div className="flex-1 max-w-md">
          <SearchBar />
        </div>

        <button
          className="btn-ghost p-gs-2"
          title="Help & About (⌘/)"
          aria-label="Help and about"
          onClick={onShowHelp}
        >
          <Info size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
