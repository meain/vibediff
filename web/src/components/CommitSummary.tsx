import type { Revision } from '../types/diff'
import CopyButton from './CopyButton'

interface CommitSummaryProps {
  revision: Revision
  filesChanged: number
  additions: number
  deletions: number
}

function formatAbsoluteTimestamp(ts: string): string {
  try {
    const date = new Date(ts)
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

function formatRelativeTimestamp(ts: string): string {
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
    if (diffDays < 30) return `${String(diffDays)}d ago`
    return date.toLocaleDateString()
  } catch {
    return ts
  }
}

export default function CommitSummary({ revision, filesChanged, additions, deletions }: CommitSummaryProps): React.ReactElement {
  const absolute = formatAbsoluteTimestamp(revision.timestamp)
  const relative = formatRelativeTimestamp(revision.timestamp)

  return (
    <div className="mx-3 mt-3 mb-3 border border-edge rounded bg-surface-raised">
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fg select-text break-words">
            {revision.description || '(no description)'}
          </div>

          <div className="mt-1.5 flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="select-text">
              <span className="text-fg">{revision.author}</span>
              <span> committed </span>
              <span title={absolute}>{relative}</span>
            </span>

            <span className="flex items-center gap-1">
              <span
                className="font-mono text-[10px] px-1 py-0.5 rounded bg-surface-inset text-fg-muted select-text cursor-text"
                title={revision.id}
              >
                {revision.shortId}
              </span>
              <CopyButton value={revision.id} title="Copy commit ID" />
            </span>

            {revision.bookmarks && revision.bookmarks.length > 0 && (
              <span className="flex items-center gap-1 flex-wrap">
                {revision.bookmarks.map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center gap-0.5 font-mono text-[10px] px-1 py-0.5 rounded leading-none"
                    style={{ background: 'var(--color-bookmark-bg)', color: 'var(--color-bookmark-fg)' }}
                  >
                    {b}
                    <CopyButton value={b} title={`Copy bookmark "${b}"`} />
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs shrink-0 pt-0.5">
          <span className="text-fg-muted">
            {filesChanged} file{filesChanged === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-2">
            <span className="text-success">+{additions}</span>
            <span className="text-danger">-{deletions}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
