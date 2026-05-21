import { useState } from 'react'
import type { Revision, VCSBackend } from '../types/diff'
import CopyButton from './CopyButton'
import RevisionDetailModal from './RevisionDetailModal'

interface RevisionListProps {
  revisions: Revision[]
  loading: boolean
  selectedRevision: string | null
  onSelectRevision: (revisionId: string | null) => void
  backend: VCSBackend
  showAll: boolean
  onToggleShowAll: () => void
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${String(diffMins)}m ago`
    if (diffHours < 24) return `${String(diffHours)}h ago`
    if (diffDays < 7) return `${String(diffDays)}d ago`
    return date.toLocaleDateString()
  } catch {
    return ts
  }
}

export default function RevisionList({
  revisions,
  loading,
  selectedRevision,
  onSelectRevision,
  backend,
  showAll,
  onToggleShowAll,
}: RevisionListProps): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [detailRevisionId, setDetailRevisionId] = useState<string | null>(null)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 pt-2 pb-1 shrink-0">
        <h3 className="text-xs font-semibold text-fg">Revisions</h3>
        <button
          onClick={onToggleShowAll}
          className="text-[10px] text-fg-muted hover:text-fg transition-colors"
        >
          {showAll ? 'All' : 'Trunk'}
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-fg-subtle p-2">
          Loading revisions...
        </div>
      ) : (
        <div className="overflow-y-auto">
          {/* Working copy option — only for git, since in jj the first revision IS the working copy */}
          {backend === 'git' && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => { onSelectRevision(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRevision(null); } }}
              className={`w-full text-left px-2 py-1.5 text-xs border-b border-edge-subtle transition-colors cursor-pointer ${
                selectedRevision === null
                  ? 'bg-accent-muted text-accent-emphasis'
                  : 'text-fg hover:bg-surface-raised'
              }`}
            >
              <div className="font-medium">Working copy changes</div>
            </div>
          )}

          {revisions.map((rev) => {
            const isSelected = rev.isWorkingCopy && backend === 'jj'
              ? selectedRevision === null
              : selectedRevision === rev.id

            const handleSelect = (): void => {
              if (rev.isWorkingCopy && backend === 'jj') {
                onSelectRevision(null)
              } else {
                onSelectRevision(rev.id)
              }
            }

            const isHovered = hoveredId === rev.id

            return (
              <div
                key={rev.id}
                role="button"
                tabIndex={0}
                onClick={handleSelect}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(); } }}
                onMouseEnter={() => { setHoveredId(rev.id) }}
                onMouseLeave={() => { setHoveredId(null) }}
                className={`relative w-full text-left pl-2 py-1.5 text-xs border-b border-edge-subtle transition-colors cursor-pointer ${
                  isHovered ? 'pr-8' : 'pr-2'
                } ${
                  isSelected
                    ? 'bg-accent-muted text-accent-emphasis'
                    : 'text-fg hover:bg-surface-raised'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="font-mono text-[10px] px-1 py-0.5 rounded bg-surface-inset text-fg-muted shrink-0 select-text cursor-text"
                    onClick={(e) => { e.stopPropagation(); }}
                    onMouseDown={(e) => { e.stopPropagation(); }}
                    title={rev.id}
                  >
                    {rev.shortId}
                  </span>
                  <CopyButton value={rev.id} title="Copy commit ID" />
                  <span className="truncate">
                    {rev.description || '(no description)'}
                  </span>
                  {rev.isWorkingCopy && (
                    <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-accent-muted text-accent-emphasis">
                      @
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-fg-muted">
                  <span className="truncate">{rev.author}</span>
                  <span>·</span>
                  <span className="shrink-0">{formatTimestamp(rev.timestamp)}</span>
                </div>
                {isHovered && (
                  <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-fg-muted hover:text-fg px-1 py-0.5 rounded hover:bg-surface-inset transition-colors"
                    title="View revision details"
                    onClick={(e) => { e.stopPropagation(); setDetailRevisionId(rev.id) }}
                  >
                    ...
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {detailRevisionId !== null && (
        <RevisionDetailModal
          revisionId={detailRevisionId}
          backend={backend}
          onClose={() => { setDetailRevisionId(null) }}
        />
      )}
    </div>
  )
}
