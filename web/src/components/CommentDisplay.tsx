import { useState, useRef, useEffect } from 'react'
import type { Comment } from '../types/diff'
import { formatRelativeTime } from '../utils/time'
import { groupIntoThreads } from '../utils/threads'

interface CommentDisplayProps {
  comments: Comment[]
  onDelete: (id: string) => void
  onUpdate?: (id: string, content: string) => Promise<void>
  onAddReply?: (parentComment: Comment, content: string) => Promise<void>
  onResolve?: (id: string) => void
  onReopen?: (id: string) => void
}


interface CommentCardProps {
  comment: Comment
  isReply?: boolean
  parentResolved?: boolean
  replyCount?: number
  repliesCollapsed?: boolean
  onToggleReplies?: () => void
  onDelete: (id: string) => void
  onUpdate?: (id: string, content: string) => Promise<void>
  onStartReply?: () => void
  onResolve?: (id: string) => void
  onReopen?: (id: string) => void
}

function CommentCard({ comment, isReply, parentResolved, replyCount, repliesCollapsed, onToggleReplies, onDelete, onUpdate, onStartReply, onResolve, onReopen }: CommentCardProps): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.content)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus()
    }
  }, [editing])

  const handleSave = (): void => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === comment.content || !onUpdate) {
      setEditing(false)
      setDraft(comment.content)
      return
    }
    setSaving(true)
    void onUpdate(comment.id, trimmed).then(() => {
      setEditing(false)
    }).catch(() => {
      // keep edit open on error
    }).finally(() => {
      setSaving(false)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditing(false)
      setDraft(comment.content)
    }
  }
  const isAgent = comment.author === 'agent'
  const canEdit = !isAgent && !!onUpdate
  const isResolved = comment.status === 'resolved'
  const dimmed = isResolved || parentResolved

  const accentClass = isAgent
    ? 'border-l-info'
    : 'border-l-accent'
  let authorLabel = 'User'
  if (isAgent) {
    authorLabel = comment.authorName ? `agent:${comment.authorName}` : 'Agent'
  }
  const rootClass = isReply
    ? `ml-6 mt-1 bg-surface border border-edge rounded-lg overflow-hidden ${dimmed ? 'opacity-60' : ''}`
    : `bg-surface border border-edge rounded-lg border-l-[3px] ${accentClass} overflow-hidden ${dimmed ? 'opacity-60' : ''}`

  return (
    <div data-comment-id={comment.id} className={rootClass}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-raised gap-2">
        <div className="text-xs text-fg-muted flex items-center gap-1.5 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
            isAgent ? 'bg-info/20 text-info' : 'bg-accent/20 text-accent'
          }`}>
            {authorLabel}
          </span>
          {!isReply && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
              isResolved ? 'bg-fg-subtle/20 text-fg-muted' : 'bg-success/20 text-success'
            }`}>
              {comment.status}
            </span>
          )}
          <span className="text-fg-subtle">·</span>
          <span className="text-fg-subtle" title={new Date(comment.createdAt).toLocaleString()}>{formatRelativeTime(comment.createdAt)}</span>
          {!isReply && replyCount !== undefined && replyCount > 0 && (
            <button
              onClick={onToggleReplies}
              className="text-fg-subtle hover:text-fg text-[10px] px-1.5 py-0.5 rounded hover:bg-surface-inset transition-colors cursor-pointer border-none bg-transparent"
              title={repliesCollapsed ? 'Show replies' : 'Hide replies'}
            >
              {repliesCollapsed ? `▸ ${replyCount}` : `▾ ${replyCount}`}
            </button>
          )}
          {!isReply && comment.commit && (
            <>
              <span className="text-fg-subtle">·</span>
              <span className="text-fg-subtle font-mono" title={comment.commit}>
                {comment.revision ? `${comment.revision.slice(0, 8)} ` : ''}@{comment.commit.slice(0, 7)}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canEdit && !editing && (
            <button
              onClick={() => { setEditing(true); }}
              className="text-fg-subtle hover:text-fg text-lg px-2 py-0 rounded hover:bg-surface-inset transition-colors cursor-pointer border-none bg-transparent"
              title="Edit comment"
            >
              ✎
            </button>
          )}
          {onStartReply && !editing && (
            <button
              onClick={onStartReply}
              className="text-fg-subtle hover:text-fg text-lg px-2 py-0 rounded hover:bg-surface-inset transition-colors cursor-pointer border-none bg-transparent"
              title="Reply"
            >
              ↩
            </button>
          )}
          {!editing && !isReply && onResolve && !isResolved && (
            <button
              onClick={() => { onResolve(comment.id); }}
              className="text-fg-subtle hover:text-success text-lg px-2 py-0 rounded hover:bg-success/10 transition-colors cursor-pointer border-none bg-transparent"
              title="Resolve thread"
            >
              ✓
            </button>
          )}
          {!editing && !isReply && onReopen && isResolved && (
            <button
              onClick={() => { onReopen(comment.id); }}
              className="text-fg-subtle hover:text-accent text-lg px-2 py-0 rounded hover:bg-accent/10 transition-colors cursor-pointer border-none bg-transparent"
              title="Reopen thread"
            >
              ↺
            </button>
          )}
          {!editing && (
            <button
              onClick={() => { onDelete(comment.id); }}
              className="text-fg-subtle hover:text-danger text-lg px-2 py-0 rounded hover:bg-danger/10 transition-colors cursor-pointer border-none bg-transparent"
              title="Delete comment"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="px-3 py-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); }}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={saving}
            className="w-full text-sm text-fg bg-surface-inset border border-edge rounded px-2 py-1.5 resize-y focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={handleSave}
              disabled={saving || !draft.trim()}
              className="text-xs px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-50 cursor-pointer border-none transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(comment.content); }}
              disabled={saving}
              className="text-xs px-2 py-0.5 rounded text-fg-muted hover:text-fg hover:bg-surface-inset cursor-pointer border-none bg-transparent transition-colors"
            >
              Cancel
            </button>
            <span className="text-[10px] text-fg-subtle ml-auto">⌘↵ save · Esc cancel</span>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 text-sm leading-relaxed text-fg whitespace-pre-wrap">
          {comment.content}
        </div>
      )}
    </div>
  )
}

export default function CommentDisplay({ comments, onDelete, onUpdate, onAddReply, onResolve, onReopen }: CommentDisplayProps): React.ReactElement | null {
  const [replyingToId, setReplyingToId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replySaving, setReplySaving] = useState(false)
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set())
  const replyRef = useRef<HTMLTextAreaElement>(null)

  const toggleThread = (id: string): void => {
    setCollapsedThreads(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  useEffect(() => {
    if (replyingToId) {
      replyRef.current?.focus()
    }
  }, [replyingToId])

  if (comments.length === 0) return null

  const threads = groupIntoThreads(comments)

  const handleReplySubmit = (rootComment: Comment): void => {
    const trimmed = replyDraft.trim()
    if (!trimmed || !onAddReply) return
    setReplySaving(true)
    void onAddReply(rootComment, trimmed).then(() => {
      setReplyingToId(null)
      setReplyDraft('')
    }).finally(() => {
      setReplySaving(false)
    })
  }

  const handleReplyKeyDown = (e: React.KeyboardEvent, rootComment: Comment): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleReplySubmit(rootComment)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setReplyingToId(null)
      setReplyDraft('')
    }
  }

  return (
    <div className="mx-4 my-2 space-y-2 max-w-2xl">
      {threads.map(thread => {
        const isCollapsed = collapsedThreads.has(thread.root.id)
        const isResolved = thread.root.status === 'resolved'
        return (
        <div key={thread.root.id}>
          <CommentCard
            comment={thread.root}
            replyCount={thread.replies.length}
            repliesCollapsed={isCollapsed}
            onToggleReplies={() => { toggleThread(thread.root.id); }}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onStartReply={onAddReply ? () => { setReplyingToId(thread.root.id); setReplyDraft(''); } : undefined}
            onResolve={onResolve}
            onReopen={onReopen}
          />
          {!isCollapsed && thread.replies.map(reply => (
            <CommentCard
              key={reply.id}
              comment={reply}
              isReply
              parentResolved={isResolved}
              onDelete={onDelete}
              onUpdate={onUpdate}
              onStartReply={onAddReply ? () => { setReplyingToId(thread.root.id); setReplyDraft(''); } : undefined}
            />
          ))}
          {!isCollapsed && replyingToId === thread.root.id && (
            <div className="ml-6 mt-1">
              <div className="px-3 py-2 bg-surface border border-edge rounded-lg">
                <textarea
                  ref={replyRef}
                  value={replyDraft}
                  onChange={(e) => { setReplyDraft(e.target.value); }}
                  onKeyDown={(e) => { handleReplyKeyDown(e, thread.root); }}
                  placeholder="Write a reply..."
                  rows={2}
                  disabled={replySaving}
                  className="w-full text-sm text-fg bg-surface-inset border border-edge rounded px-2 py-1.5 resize-none focus:outline-none focus:border-accent"
                  style={{ fontFamily: 'inherit' }}
                />
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={() => { handleReplySubmit(thread.root); }}
                    disabled={replySaving || !replyDraft.trim()}
                    className="text-xs px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-50 cursor-pointer border-none transition-colors"
                  >
                    {replySaving ? 'Sending…' : 'Reply'}
                  </button>
                  <button
                    onClick={() => { setReplyingToId(null); setReplyDraft(''); }}
                    disabled={replySaving}
                    className="text-xs px-2 py-0.5 rounded text-fg-muted hover:text-fg hover:bg-surface-inset cursor-pointer border-none bg-transparent transition-colors"
                  >
                    Cancel
                  </button>
                  <span className="text-[10px] text-fg-subtle ml-auto">⌘↵ send · Esc cancel</span>
                </div>
              </div>
            </div>
          )}
        </div>
        )
      })}
    </div>
  )
}
