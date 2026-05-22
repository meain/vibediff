import { useEffect, useState, useCallback } from 'react'
import type { RevisionDetail, VCSBackend } from '../types/diff'
import CopyButton from './CopyButton'

interface RevisionDetailModalProps {
  revisionId: string
  backend: VCSBackend
  onClose: () => void
  onSuccess: () => void
}

type ConfirmAction = 'squash' | 'new' | null

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

function ActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-full bg-surface-inset border-2 border-edge flex items-center justify-center text-fg-muted hover:text-fg hover:border-accent transition-colors shadow-md cursor-pointer"
    >
      {children}
    </button>
  )
}

export default function RevisionDetailModal({
  revisionId,
  backend,
  onClose,
  onSuccess,
}: RevisionDetailModalProps): React.ReactElement {
  const [detail, setDetail] = useState<RevisionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [selectedBookmarks, setSelectedBookmarks] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
    if (e.key === 'Escape') {
      if (confirmAction !== null) {
        setConfirmAction(null)
        setActionError(null)
      } else {
        onClose()
      }
    }
  }, [onClose, confirmAction])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [handleKeyDown])

  const handleConfirm = useCallback((): void => {
    if (!detail || actionLoading) return
    setActionLoading(true)
    setActionError(null)

    void (async () => {
      try {
        let res: Response
        if (confirmAction === 'squash') {
          res = await fetch(`/api/revisions/${encodeURIComponent(revisionId)}/squash`, {
            method: 'POST',
          })
        } else {
          res = await fetch(`/api/revisions/${encodeURIComponent(revisionId)}/new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookmarks: [...selectedBookmarks] }),
          })
        }
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text.trim() || `HTTP ${String(res.status)}`)
        }
        onSuccess()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setActionLoading(false)
      }
    })()
  }, [confirmAction, detail, revisionId, selectedBookmarks, actionLoading, onSuccess])

  const refsLabel = backend === 'jj' ? 'Bookmarks' : 'Branches'
  const isJJ = backend === 'jj'

  const toggleBookmark = (name: string): void => {
    setSelectedBookmarks(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-surface-overlay"
      onClick={onClose}
    >
      <div
        className="relative bg-surface-inset rounded-lg shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]"
        onClick={(e) => { e.stopPropagation() }}
      >
        {/* New revision button — top center, straddling the border */}
        {isJJ && detail && confirmAction === null && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <ActionButton
              onClick={() => {
                setConfirmAction('new')
                setSelectedBookmarks(new Set())
                setActionError(null)
              }}
              title="Insert new revision after this one"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 5h14M12 19V9M9 12l3-3 3 3" />
              </svg>
            </ActionButton>
          </div>
        )}

        <div className="px-4 py-3 border-b border-edge flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold text-fg">Revision Detail</h3>
          <button
            onClick={confirmAction !== null ? () => { setConfirmAction(null); setActionError(null) } : onClose}
            className="px-3 py-[3px] text-xs font-medium bg-surface-inset text-fg border border-edge rounded-md hover:bg-edge transition-colors cursor-pointer"
          >
            {confirmAction !== null ? 'Back' : 'Close'}
          </button>
        </div>

        <div className="overflow-y-auto p-4 flex-1">
          {confirmAction !== null ? (
            <ConfirmView
              action={confirmAction}
              detail={detail}
              selectedBookmarks={selectedBookmarks}
              onToggleBookmark={toggleBookmark}
              actionLoading={actionLoading}
              actionError={actionError}
              onConfirm={handleConfirm}
              onCancel={() => { setConfirmAction(null); setActionError(null) }}
              onClose={onClose}
            />
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Squash button — bottom center, straddling the border */}
        {isJJ && detail && confirmAction === null && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-10">
            <ActionButton
              onClick={() => {
                setConfirmAction('squash')
                setActionError(null)
              }}
              title="Squash this revision into its parent"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 19h14M12 5v10M9 12l3 3 3-3" />
              </svg>
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  )
}

interface ConfirmViewProps {
  action: 'squash' | 'new'
  detail: RevisionDetail | null
  selectedBookmarks: Set<string>
  onToggleBookmark: (name: string) => void
  actionLoading: boolean
  actionError: string | null
  onConfirm: () => void
  onCancel: () => void
  onClose: () => void
}

function ConfirmView({
  action,
  detail,
  selectedBookmarks,
  onToggleBookmark,
  actionLoading,
  actionError,
  onConfirm,
  onCancel,
  onClose,
}: ConfirmViewProps): React.ReactElement {
  const shortId = detail?.shortId ?? '…'

  if (actionError) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-red-500">{actionError}</p>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium bg-surface-raised text-fg border border-edge rounded-md hover:bg-edge transition-colors cursor-pointer"
        >
          Close
        </button>
      </div>
    )
  }

  if (action === 'squash') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-fg">
          Squash <span className="font-mono text-xs bg-surface-raised px-1 py-0.5 rounded">{shortId}</span> into its parent?
        </p>
        <p className="text-xs text-fg-muted">This cannot be undone without jj undo.</p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={actionLoading}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-fg rounded-md hover:bg-accent-emphasis transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading ? 'Squashing…' : 'Squash'}
          </button>
          <button
            onClick={onCancel}
            disabled={actionLoading}
            className="px-3 py-1.5 text-xs font-medium bg-surface-raised text-fg border border-edge rounded-md hover:bg-edge transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const refs = detail?.refs ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg">
        Insert a new empty revision after <span className="font-mono text-xs bg-surface-raised px-1 py-0.5 rounded">{shortId}</span>?
      </p>
      {refs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-fg-muted">Move bookmarks to the new revision:</p>
          {refs.map(bm => (
            <label key={bm} className="flex items-center gap-2 text-xs text-fg cursor-pointer">
              <input
                type="checkbox"
                checked={selectedBookmarks.has(bm)}
                onChange={() => { onToggleBookmark(bm) }}
                className="rounded accent-accent"
              />
              <span className="font-mono">{bm}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={actionLoading}
          className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-fg rounded-md hover:bg-accent-emphasis transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {actionLoading ? 'Creating…' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          disabled={actionLoading}
          className="px-3 py-1.5 text-xs font-medium bg-surface-raised text-fg border border-edge rounded-md hover:bg-edge transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
