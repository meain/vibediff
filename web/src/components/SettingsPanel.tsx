import React, { useState, useEffect, useRef } from 'react'
import type { ViewMode } from '../types/diff'
import { getIconButtonClassName } from '../utils/buttonStyles'
import {
  Cog6ToothIcon,
  ViewColumnsIcon,
  Bars3Icon,
  DocumentIcon,
  DocumentDuplicateIcon,
  EyeIcon,
  EyeSlashIcon,
  ClipboardDocumentIcon,
  SunIcon,
  MoonIcon,
  UserIcon,
  SparklesIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline'

interface SettingsPanelProps {
  showComments: boolean
  onToggleComments: () => void
  onCopyAllComments: () => void
  copyAllFeedback: boolean
  hasComments: boolean
  totalThreads: number
  pendingThreads: number
  commentCountsByAuthor: { user: number, agents: Map<string, number> }
  viewMode: ViewMode
  onToggleViewMode: () => void
  displayMode: 'single' | 'all'
  onToggleDisplayMode: () => void
  isDark: boolean
  onToggleDark: () => void
  onShowHelp: () => void
}

export default function SettingsPanel({
  showComments,
  onToggleComments,
  onCopyAllComments,
  copyAllFeedback,
  hasComments,
  totalThreads,
  pendingThreads,
  commentCountsByAuthor,
  viewMode,
  onToggleViewMode,
  displayMode,
  onToggleDisplayMode,
  isDark,
  onToggleDark,
  onShowHelp,
}: SettingsPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => { document.removeEventListener('mousedown', handler) }
  }, [])

  const itemClass = 'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left rounded transition-colors hover:bg-surface-inset disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(o => !o) }}
        className={getIconButtonClassName(false)}
        title="Settings"
      >
        <Cog6ToothIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-edge rounded-md shadow-lg z-50 py-1 text-fg">

          {/* Comments */}
          <div className="px-3 py-2 bg-surface-inset/60 border-b border-edge mb-1">
            <div className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wide mb-1">Comments</div>
            {hasComments ? (
              <div className="text-xs text-fg-muted space-y-1">
                <div>{pendingThreads} pending, {totalThreads} total</div>

                {commentCountsByAuthor.user > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <UserIcon className="w-3 h-3 shrink-0" />
                      User
                    </span>
                    <span className="text-fg-subtle">{commentCountsByAuthor.user}</span>
                  </div>
                )}

                {commentCountsByAuthor.agents.size > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wide mt-1.5 mb-0.5">Agents</div>
                    {[...commentCountsByAuthor.agents.entries()].map(([name, count]) => (
                      <div key={name} className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <SparklesIcon className="w-3 h-3 shrink-0" />
                          {name}
                        </span>
                        <span className="text-fg-subtle">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-fg-muted">No comments yet</div>
            )}
          </div>

          {/* View mode */}
          <button className={itemClass} onClick={() => { onToggleViewMode(); }}>
            {viewMode === 'unified' ? (
              <ViewColumnsIcon className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Bars3Icon className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{viewMode === 'unified' ? 'Split view' : 'Unified view'}</span>
          </button>

          {/* Display mode */}
          <button className={itemClass} onClick={() => { onToggleDisplayMode(); }}>
            {displayMode === 'single' ? (
              <DocumentDuplicateIcon className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <DocumentIcon className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{displayMode === 'single' ? 'All files' : 'Single file'}</span>
          </button>

          <div className="my-1 border-t border-edge" />

          {/* Comments visibility */}
          <button className={itemClass} onClick={() => { onToggleComments(); }}>
            {showComments ? (
              <EyeSlashIcon className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <EyeIcon className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{showComments ? 'Hide comments' : 'Show comments'}</span>
          </button>

          {/* Copy all comments */}
          <button
            className={itemClass}
            disabled={!hasComments}
            onClick={() => { if (hasComments) onCopyAllComments(); }}
          >
            <ClipboardDocumentIcon className="w-3.5 h-3.5 shrink-0" />
            <span>{copyAllFeedback ? 'Copied!' : 'Copy all comments'}</span>
          </button>

          <div className="my-1 border-t border-edge" />

          {/* Theme */}
          <button className={itemClass} onClick={() => { onToggleDark(); }}>
            {isDark ? (
              <SunIcon className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <MoonIcon className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>

          <div className="my-1 border-t border-edge" />

          {/* Help */}
          <button className={itemClass} onClick={() => { setOpen(false); onShowHelp(); }}>
            <QuestionMarkCircleIcon className="w-3.5 h-3.5 shrink-0" />
            <span>Keyboard shortcuts</span>
          </button>

        </div>
      )}
    </div>
  )
}
