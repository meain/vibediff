import { useState, useCallback, useEffect, useContext } from 'react'
import type { Comment, Revision } from '../types/diff'
import { WebSocketContext } from '../contexts/WebSocketContext'
import { groupIntoThreads } from '../utils/threads'

interface UseCommentsReturn {
  comments: Comment[]
  addComment: (file: string, line: number, content: string, lineEnd: number, parentId?: string) => Promise<Comment>
  updateComment: (id: string, content: string) => Promise<void>
  deleteComment: (id: string) => Promise<void>
  resolveComment: (id: string) => Promise<void>
  reopenComment: (id: string) => Promise<void>
  getCommentsForLine: (file: string, line: number) => Comment[]
  getCommentRangeLines: (file: string, lineOrder: number[]) => Set<number>
  formatCommentsForExport: (revisions?: Revision[]) => string
}

export function useComments(currentDirectory?: string, selectedRevision?: string | null): UseCommentsReturn {
  const [comments, setComments] = useState<Comment[]>([])
  // Tolerate the absence of a WebSocketProvider (unit tests render
  // useComments directly with renderHook). Outside a provider the value
  // stays at zero, so the effect runs only on mount and on
  // currentDirectory changes — matching pre-WS-broadcast behavior.
  const wsContext = useContext(WebSocketContext)
  const lastCommentUpdate = wsContext?.lastCommentUpdate ?? 0

  // Clear stale comments immediately when the scoping context changes so
  // the copy-comments button and inline threads don't show the previous
  // revision's data while the fetch is in-flight.
  useEffect(() => {
    setComments([])
  }, [currentDirectory, selectedRevision])

  // Fetch comments on mount, on directory/revision change, and whenever the
  // server broadcasts a comment_changed event (e.g. an agent reply
  // posted through the MCP reply_to_comment tool).
  useEffect(() => {
    const fetchComments = async (): Promise<void> => {
      try {
        // Filter by revision so only comments for the current context are shown.
        // working-copy (null/undefined) → revision="working-copy" (comments with no revision tag)
        // specific revision → revision=<id>
        const revParam = selectedRevision ?? 'working-copy'
        const response = await fetch(`/api/review/comments?revision=${encodeURIComponent(revParam)}`)
        if (response.ok) {
          const data = await response.json() as Comment[]
          setComments(data)
        }
      } catch (error) {
        console.error('Failed to fetch comments:', error)
      }
    }

    void fetchComments()
  }, [currentDirectory, lastCommentUpdate, selectedRevision])

  const addComment = useCallback(async (file: string, line: number, content: string, lineEnd: number, parentId?: string) => {
    try {
      // selectedRevision is empty for the working-copy view; the server resolves
      // an empty revision to the working-copy commit (HEAD / @).
      const body: Record<string, unknown> = { file, line, content, lineEnd }
      if (selectedRevision) {
        body.revision = selectedRevision
      }
      if (parentId) {
        body.parentId = parentId
      }
      const response = await fetch('/api/review/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw new Error('Failed to add comment')
      }

      const createdComment = await response.json() as Comment
      setComments(prev => [...prev, createdComment])
      return createdComment
    } catch (error) {
      console.error('Failed to add comment:', error)
      throw error
    }
  }, [selectedRevision])

  const updateComment = useCallback(async (id: string, content: string) => {
    const response = await fetch(`/api/review/comment/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    })
    if (!response.ok) throw new Error('Failed to update comment')
    setComments(prev => prev.map(c => c.id === id ? { ...c, content } : c))
  }, [])

  const setLocalStatus = (id: string, status: Comment['status']): void => {
    setComments(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }

  const resolveComment = useCallback(async (id: string) => {
    const response = await fetch(`/api/review/comment/${id}/resolve`, { method: 'POST' })
    if (!response.ok) {
      throw new Error('Failed to resolve comment')
    }
    setLocalStatus(id, 'resolved')
  }, [])

  const reopenComment = useCallback(async (id: string) => {
    const response = await fetch(`/api/review/comment/${id}/reopen`, { method: 'POST' })
    if (!response.ok) {
      throw new Error('Failed to reopen comment')
    }
    setLocalStatus(id, 'open')
  }, [])

  const deleteComment = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/review/comment/${id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to delete comment')
      }

      setComments(prev => prev.filter(c => c.id !== id))
    } catch (error) {
      console.error('Failed to delete comment:', error)
      throw error
    }
  }, [])

  const getCommentsForLine = useCallback((file: string, line: number) => {
    // lineEnd === 0 means the API caller omitted it; treat it as equal to line.
    return comments.filter(c => c.file === file && (c.lineEnd === line || (c.lineEnd === 0 && c.line === line)))
  }, [comments])

  const getCommentRangeLines = useCallback((file: string, lineOrder: number[]): Set<number> => {
    const result = new Set<number>()
    const fileComments = comments.filter(c => c.file === file)
    for (const c of fileComments) {
      const startIdx = lineOrder.indexOf(c.line)
      const endIdx = lineOrder.indexOf(c.lineEnd)
      if (startIdx === -1 || endIdx === -1) continue
      const lo = Math.min(startIdx, endIdx)
      const hi = Math.max(startIdx, endIdx)
      for (let i = lo; i <= hi; i++) {
        result.add(lineOrder[i])
      }
    }
    return result
  }, [comments])

  const formatCommentsForExport = useCallback((revisions?: Revision[]) => {
    if (comments.length === 0) return ''

    const threads = new Map(groupIntoThreads(comments).map(t => [t.root.id, t]))
    const authorLabel = (c: Comment): string => c.author === 'agent' ? 'Agent' : 'User'

    const renderSection = (sectionRoots: Comment[]): string[] => {
      // Group roots by file
      const byFile = new Map<string, Comment[]>()
      for (const c of sectionRoots) {
        const list = byFile.get(c.file) ?? []
        list.push(c)
        byFile.set(c.file, list)
      }
      const out: string[] = []
      for (const [file, roots] of byFile) {
        out.push(`### ${file}`, '')
        for (const root of roots) {
          const lineRef = root.line === root.lineEnd
            ? `Line ${Math.abs(root.line)}`
            : `Lines ${Math.abs(root.line)}–${Math.abs(root.lineEnd)}`
          out.push(`- **${lineRef}** [${authorLabel(root)}]: ${root.content}`)
          const thread = threads.get(root.id)
          if (thread) {
            for (const reply of thread.replies) {
              out.push(`  - [${authorLabel(reply)}]: ${reply.content}`)
            }
          }
        }
        out.push('')
      }
      return out
    }

    const openRoots = comments.filter(c => !c.parentId && c.status === 'open')
    const resolvedRoots = comments.filter(c => !c.parentId && c.status === 'resolved')

    // Build a revision description lookup from the provided list.
    // Each comment carries a revision ID (jj change ID) and/or a commit SHA.
    // We prefer the revision description; fall back to the short commit SHA.
    const revMap = new Map<string, Revision>()
    for (const r of revisions ?? []) {
      revMap.set(r.id, r)
    }
    const revisionHeader = (): string => {
      // Collect unique revision IDs referenced by root comments
      const ids = [...new Set(comments.filter(c => !c.parentId && !!c.revision).map(c => c.revision as string))]
      if (ids.length === 0) return ''
      return ids.map(id => {
        const r = revMap.get(id)
        if (r) {
          const desc = r.description || '(no description)'
          return `> **${r.shortId}** — ${desc}  \n> ${r.author} · ${new Date(r.timestamp).toLocaleDateString()}`
        }
        // Fallback: just show the short commit SHA if we have it
        const commit = comments.find(c => c.revision === id)?.commit
        return commit ? `> **${commit.slice(0, 7)}**` : `> ${id.slice(0, 8)}`
      }).join('\n')
    }

    const lines: string[] = ['# Review Comments', '']

    const header = revisionHeader()
    if (header) lines.push(header, '')

    if (openRoots.length > 0) {
      lines.push('## Open', '', ...renderSection(openRoots))
    }
    if (resolvedRoots.length > 0) {
      lines.push('## Resolved', '', ...renderSection(resolvedRoots))
    }

    return lines.join('\n')
  }, [comments])

  return {
    comments,
    addComment,
    updateComment,
    deleteComment,
    resolveComment,
    reopenComment,
    getCommentsForLine,
    getCommentRangeLines,
    formatCommentsForExport
  }
}
