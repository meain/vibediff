import { useEffect, useState, useCallback } from 'react'
import type { RevisionDetail, VCSBackend } from '../types/diff'
import CopyButton from './CopyButton'

interface RevisionDetailModalProps {
  revisionId: string
  backend: VCSBackend
  onClose: () => void
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

function Field({
  label,
  value,
  mono = false,
  copyValue,
}: {
  label: string
  value: string
  mono?: boolean
  copyValue?: string
}): React.ReactElement {
  return (
    <div>
      <div className="text-[10px] font-medium text-fg-muted uppercase tracking-wide mb-0.5">
        {label}
      </div>
      <div className={`flex items-center gap-1 text-xs text-fg ${mono ? 'font-mono' : ''}`}>
        <span className={mono ? 'select-text cursor-text break-all' : ''}>{value || '—'}</span>
        {copyValue != null && value ? <CopyButton value={copyValue} title={`Copy ${label}`} /> : null}
      </div>
    </div>
  )
}

export default function RevisionDetailModal({
  revisionId,
  backend,
  onClose,
}: RevisionDetailModalProps): React.ReactElement {
  const [detail, setDetail] = useState<RevisionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/revisions/${encodeURIComponent(revisionId)}`)
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
        setDetail(await res.json() as RevisionDetail)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    })()
  }, [revisionId])

  const handleKeyDown = useCallback((e: KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [handleKeyDown])

  const refsLabel = backend === 'jj' ? 'Bookmarks' : 'Branches'

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-surface-overlay"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]"
        onClick={(e) => { e.stopPropagation() }}
      >
        <div className="px-4 py-3 border-b border-edge flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold text-fg">Revision Detail</h3>
          <button
            onClick={onClose}
            className="px-3 py-[3px] text-xs font-medium bg-surface-inset text-fg border border-edge rounded-md hover:bg-edge transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto p-4 flex-1">
          {loading && (
            <div className="text-xs text-fg-muted">Loading...</div>
          )}
          {error && (
            <div className="text-xs text-red-500">{error}</div>
          )}
          {detail && (
            <div className="space-y-3">
              {backend === 'jj' && (
                <Field
                  label="Revision ID"
                  value={detail.id}
                  mono
                  copyValue={detail.id}
                />
              )}
              <Field
                label="Commit ID"
                value={detail.commitId}
                mono
                copyValue={detail.commitId}
              />
              <Field label="Author" value={detail.author} />
              <Field label="Email" value={detail.authorEmail} />
              <Field
                label="Timestamp"
                value={detail.timestamp ? `${formatTimestamp(detail.timestamp)} (${detail.timestamp})` : '—'}
              />
              <Field
                label={refsLabel}
                value={detail.refs.length > 0 ? detail.refs.join(', ') : '—'}
              />
              <Field
                label="Tags"
                value={detail.tags.length > 0 ? detail.tags.join(', ') : '—'}
              />
              <div>
                <div className="text-[10px] font-medium text-fg-muted uppercase tracking-wide mb-1">
                  Description
                </div>
                <pre className="text-xs text-fg whitespace-pre-wrap font-sans leading-relaxed">
                  {detail.description || '—'}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
