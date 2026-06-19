import { useState } from 'react'
import type { Revision, VCSBackend } from '../types/diff'
import CopyButton from './CopyButton'
import { formatRelativeTime } from '../utils/time'

interface RevisionListProps {
  revisions: Revision[]
  loading: boolean
  selectedRevision: string | null
  onSelectRevision: (revisionId: string | null) => void
  backend: VCSBackend
  reviewedRevisions?: Set<string>
}

export default function RevisionList({
  revisions,
  loading,
  selectedRevision,
  onSelectRevision,
  backend,
  reviewedRevisions,
}: RevisionListProps): React.ReactElement {
  const [filter, setFilter] = useState('')

  const query = filter.trim().toLowerCase()
  const filteredRevisions = query
    ? revisions.filter(rev =>
        rev.id.toLowerCase().includes(query) ||
        rev.shortId.toLowerCase().includes(query) ||
        rev.description.toLowerCase().includes(query)
      )
    : revisions

  if (loading) {
    return (
      <div className="text-xs text-fg-subtle p-2">
        Loading revisions...
      </div>
    )
  }

  return (
    <div className="overflow-y-auto">
      {/* Filter input */}
      <div className="px-2 py-1.5 border-b border-edge">
        <input
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); }}
          placeholder="Filter by ID or message…"
          className="w-full px-2 py-1 text-xs bg-surface border border-edge rounded text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Working copy option — only for git, since in jj the first revision IS the working copy */}
      {backend === 'git' && !query && (
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
          <div className="flex items-center gap-1">
            {reviewedRevisions?.has('working-copy') && (
              <span className="text-[10px] text-success shrink-0" title="All files reviewed">✓</span>
            )}
            <span className="font-medium">Working copy changes</span>
          </div>
        </div>
      )}

      {filteredRevisions.length === 0 && query && (
        <div className="px-2 py-3 text-xs text-fg-subtle text-center">No revisions match</div>
      )}

      {filteredRevisions.map((rev) => {
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

        return (
          <div
            key={rev.id}
            role="button"
            tabIndex={0}
            onClick={handleSelect}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(); } }}
            className={`w-full text-left px-2 py-1.5 text-xs border-b border-edge-subtle transition-colors cursor-pointer ${
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
              {reviewedRevisions?.has(rev.isWorkingCopy && backend === 'jj' ? 'working-copy' : rev.id) && (
                <span className="text-[10px] text-success shrink-0" title="All files reviewed">✓</span>
              )}
              <span className="truncate">
                {rev.description || '(no description)'}
              </span>
              {rev.isWorkingCopy && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-accent-muted text-accent-emphasis">
                  @
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-fg-muted flex-wrap">
              <span className="truncate">{rev.author}</span>
              <span>·</span>
              <span className="shrink-0">{formatRelativeTime(rev.timestamp)}</span>
              {rev.bookmarks && rev.bookmarks.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-mono leading-none"
                  style={{ background: 'var(--color-bookmark-bg)', color: 'var(--color-bookmark-fg)' }}
                >
                  {b}
                  <CopyButton value={b} title={`Copy bookmark "${b}"`} />
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
