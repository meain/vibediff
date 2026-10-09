import { useMemo, useState } from 'react'
import type { Comment } from '../types/diff'
import { CheckCircleIcon, SparklesIcon, UserIcon } from '@heroicons/react/24/outline'

interface CommentListProps {
  comments: Comment[]
  onSelectComment: (comment: Comment) => void
}

function lineLabel(c: Comment): string {
  if (c.line === 0) return ''
  const start = Math.abs(c.line)
  const end = Math.abs(c.lineEnd)
  return start === end ? `:${String(start)}` : `:${String(start)}–${String(end)}`
}

/** Searchable list of top-level comment threads; clicking one navigates to it in the diff. */
export default function CommentList({ comments, onSelectComment }: CommentListProps): React.ReactElement {
  const [query, setQuery] = useState('')

  const threads = useMemo(() => {
    const replyCounts = new Map<string, number>()
    for (const c of comments) {
      if (c.parentId) replyCounts.set(c.parentId, (replyCounts.get(c.parentId) ?? 0) + 1)
    }
    const q = query.trim().toLowerCase()
    return comments
      .filter(c => !c.parentId)
      .filter(c => q === '' || [c.content, c.file, c.authorName ?? '', c.author].some(s => s.toLowerCase().includes(q)))
      .sort((a, b) => a.file.localeCompare(b.file) || Math.abs(a.line) - Math.abs(b.line))
      .map(c => ({ comment: c, replies: replyCounts.get(c.id) ?? 0 }))
  }, [comments, query])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-none flex items-stretch border-b border-edge">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setQuery('') }}
          placeholder="Search comments…"
          aria-label="Search comments"
          className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-surface-inset text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {threads.length === 0 ? (
          <div className="px-3 py-4 text-xs text-fg-subtle text-center">
            {comments.length === 0 ? 'No comments yet' : 'No matching comments'}
          </div>
        ) : threads.map(({ comment: c, replies }) => (
          <button
            key={c.id}
            onClick={() => { onSelectComment(c); }}
            className="block w-full text-left px-2 py-1.5 border-b border-edge-subtle hover:bg-surface-inset transition-colors cursor-pointer"
            title={c.content}
          >
            <div className="flex items-center gap-1 text-[11px] text-fg-muted">
              {c.author === 'agent' ? (
                <SparklesIcon className="w-3 h-3 shrink-0" />
              ) : (
                <UserIcon className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate font-mono">{c.file}{lineLabel(c)}</span>
              {c.status !== 'open' && <CheckCircleIcon className="w-3 h-3 shrink-0 text-success ml-auto" />}
              {replies > 0 && (
                <span className={`shrink-0 text-fg-subtle ${c.status === 'open' ? 'ml-auto' : ''}`}>
                  {replies} {replies === 1 ? 'reply' : 'replies'}
                </span>
              )}
            </div>
            <div className={`text-xs truncate mt-0.5 ${c.status === 'open' ? 'text-fg' : 'text-fg-subtle'}`}>
              {c.content.split('\n', 1)[0]}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
