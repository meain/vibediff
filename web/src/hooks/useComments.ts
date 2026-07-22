import { useState, useCallback, useEffect, useContext, useMemo } from 'react'
import type { Comment, Revision } from '../types/diff'
import { WebSocketContext } from '../contexts/WebSocketContext'
import { groupIntoThreads } from '../utils/threads'

// Deleted lines are keyed by the negative of their old-file line number (see
// FileDiff.tsx's lineNumberOf), so a negative value here means the comment
// anchors to the removed side of the diff rather than the added/context side.
function formatLineRef(line: number, lineEnd: number): string {
  const startTag = line < 0 ? ' (removed)' : ''
  const endTag = lineEnd < 0 ? ' (removed)' : ''
  if (line === lineEnd) {
    return `Line ${String(Math.abs(line))}${startTag}`
  }
  return `Lines ${String(Math.abs(line))}${startTag}–${String(Math.abs(lineEnd))}${endTag}`
}

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
  formatPendingCommentsForExport: (revisions?: Revision[]) => string
  clearComments: () => Promise<void>
  fetchError: string | null
  clearFetchError: () => void
}

export function useComments(currentDirectory?: string, selectedRevision?: string | null): UseCommentsReturn {
  const [comments, setComments] = useState<Comment[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const clearFetchError = useCallback(() => { setFetchError(null) }, [])
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
        const params = new URLSearchParams()
        if (currentDirectory) params.set('directory', currentDirectory)
        params.set('revision', revParam)
        const response = await fetch(`/api/review/comments?${params.toString()}`)
        if (response.ok) {
          const data = await response.json() as Comment[]
          setComments(data)
          setFetchError(null)
        }
      } catch (error) {
        console.error('Failed to fetch comments:', error)
        setFetchError('Failed to load comments')
      }
    }

    void fetchComments()
  }, [currentDirectory, lastCommentUpdate, selectedRevision])

  const addComment = useCallback(async (file: string, line: number, content: string, lineEnd: number, parentId?: string) => {
    try {
      // selectedRevision is empty for the working-copy view; the server resolves
      // an empty revision to the working-copy commit (HEAD / @).
      const body: Record<string, unknown> = { file, line, content, lineEnd, directory: currentDirectory }
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
  }, [currentDirectory, selectedRevision])

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

  const commentIndex = useMemo((): Map<string, Map<number, Comment[]>> => {
    const index = new Map<string, Map<number, Comment[]>>()
    for (const c of comments) {
      // lineEnd === 0 means the API caller omitted it; index on c.line instead.
      const key = c.lineEnd === 0 ? c.line : c.lineEnd
      let fileMap = index.get(c.file)
      if (!fileMap) {
        fileMap = new Map<number, Comment[]>()
        index.set(c.file, fileMap)
      }
      const list = fileMap.get(key) ?? []
      list.push(c)
      fileMap.set(key, list)
    }
    return index
  }, [comments])

  const getCommentsForLine = useCallback((file: string, line: number) => {
    return commentIndex.get(file)?.get(line) ?? []
  }, [commentIndex])

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
    const authorLabel = (c: Comment): string => {
      if (c.author !== 'agent') return 'User'
      return c.authorName ? `agent:${c.authorName}` : 'Agent'
    }

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
          const lineRef = formatLineRef(root.line, root.lineEnd)
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
          const desc = r.description.split('\n', 1)[0] || '(no description)'
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

  const formatPendingCommentsForExport = useCallback((revisions?: Revision[]) => {
    const pendingRoots = comments.filter(c => !c.parentId && c.status === 'open')
    if (pendingRoots.length === 0) return ''

    const threads = new Map(groupIntoThreads(comments).map(t => [t.root.id, t]))
    const authorLabel = (c: Comment): string => {
      if (c.author !== 'agent') return 'User'
      return c.authorName ? `agent:${c.authorName}` : 'Agent'
    }
    const revMap = new Map<string, Revision>()
    for (const r of revisions ?? []) revMap.set(r.id, r)

    const revisionHeader = (): string => {
      const ids = [...new Set(pendingRoots.filter(c => !!c.revision).map(c => c.revision as string))]
      if (ids.length === 0) return ''
      return ids.map(id => {
        const r = revMap.get(id)
        if (r) return `> **${r.shortId}** — ${r.description.split('\n', 1)[0] || '(no description)'}  \n> ${r.author} · ${new Date(r.timestamp).toLocaleDateString()}`
        const commit = comments.find(c => c.revision === id)?.commit
        return commit ? `> **${commit.slice(0, 7)}**` : `> ${id.slice(0, 8)}`
      }).join('\n')
    }

    const byFile = new Map<string, Comment[]>()
    for (const c of pendingRoots) {
      const list = byFile.get(c.file) ?? []
      list.push(c)
      byFile.set(c.file, list)
    }

    const lines: string[] = ['# Pending Review Comments', '']
    const header = revisionHeader()
    if (header) lines.push(header, '')
    for (const [file, roots] of byFile) {
      lines.push(`### ${file}`, '')
      for (const root of roots) {
        const lineRef = formatLineRef(root.line, root.lineEnd)
        lines.push(`- **${lineRef}** [${authorLabel(root)}]: ${root.content}`)
        const thread = threads.get(root.id)
        if (thread) {
          for (const reply of thread.replies) lines.push(`  - [${authorLabel(reply)}]: ${reply.content}`)
        }
      }
      lines.push('')
    }
    return lines.join('\n')
  }, [comments])

  const clearComments = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (currentDirectory) params.set('directory', currentDirectory)
      const response = await fetch(`/api/review/comments?${params.toString()}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to clear comments')
      setComments([])
    } catch (error) {
      console.error('Failed to clear comments:', error)
      throw error
    }
  }, [currentDirectory])

  return {
    comments,
    addComment,
    updateComment,
    deleteComment,
    resolveComment,
    reopenComment,
    getCommentsForLine,
    getCommentRangeLines,
    formatCommentsForExport,
    formatPendingCommentsForExport,
    clearComments,
    fetchError,
    clearFetchError,
  }
}
