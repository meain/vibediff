import { useMemo } from 'react'
import type { Comment } from '../types/diff'
import CommentDisplay from './CommentDisplay'

interface OutsideDiffCommentsProps {
  // Comments (roots and replies) on files that are not part of the current diff.
  comments: Comment[]
  onDelete: (id: string) => Promise<void>
  onUpdate?: (id: string, content: string) => Promise<void>
  onAddReply?: (parentComment: Comment, content: string) => Promise<void>
  onResolve?: (id: string) => Promise<void>
  onReopen?: (id: string) => Promise<void>
}

interface LineGroup {
  line: number
  comments: Comment[]
}

function lineLabel(c: Comment): string {
  if (c.line === 0) return 'File'
  return c.lineEnd !== c.line ? `Lines ${String(Math.abs(c.line))}–${String(Math.abs(c.lineEnd))}` : `Line ${String(Math.abs(c.line))}`
}

// Bottom-of-page section for comments whose file isn't in the diff being
// viewed, so they stay reachable instead of silently disappearing.
export default function OutsideDiffComments({ comments, onDelete, onUpdate, onAddReply, onResolve, onReopen }: OutsideDiffCommentsProps): React.ReactElement | null {
  const byFile = useMemo(() => {
    const files = new Map<string, Map<number, LineGroup>>()
    for (const c of comments) {
      let lines = files.get(c.file)
      if (!lines) {
        lines = new Map()
        files.set(c.file, lines)
      }
      const group = lines.get(c.line)
      if (group) group.comments.push(c)
      else lines.set(c.line, { line: c.line, comments: [c] })
    }
    return files
  }, [comments])

  if (comments.length === 0) return null

  const rootCount = comments.filter(c => !c.parentId).length

  return (
    <section className="mx-3 my-4 border border-edge rounded bg-surface-raised" data-testid="outside-diff-comments">
      <header className="px-4 py-2 border-b border-edge text-sm font-semibold text-fg">
        Comments on files not in this diff
        <span className="ml-2 text-xs font-normal text-fg-muted">{String(rootCount)}</span>
      </header>
      {[...byFile].map(([file, lines]) => (
        <div key={file} className="border-b border-edge last:border-b-0 py-2">
          <div className="px-4 text-xs font-mono text-fg-muted select-text">{file}</div>
          {[...lines.values()].sort((a, b) => a.line - b.line).map(group => (
            <div key={group.line} className="mt-1">
              <div className="px-4 text-[10px] uppercase tracking-wide text-fg-subtle">{lineLabel(group.comments[0])}</div>
              <CommentDisplay
                comments={group.comments}
                onDelete={(id) => { void onDelete(id) }}
                onUpdate={onUpdate}
                onAddReply={onAddReply}
                onResolve={onResolve ? (id) => { void onResolve(id) } : undefined}
                onReopen={onReopen ? (id) => { void onReopen(id) } : undefined}
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
