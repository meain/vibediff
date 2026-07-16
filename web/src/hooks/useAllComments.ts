import { useState, useEffect, useMemo, useContext } from 'react'
import type { Comment } from '../types/diff'
import { WebSocketContext } from '../contexts/WebSocketContext'

// Fetches every comment for the directory, unscoped by revision, so callers
// can derive counts that span all revisions (e.g. the revision list graph).
// useComments intentionally can't do this itself — it filters to whichever
// revision is currently selected.
export function useAllComments(directory?: string): Map<string, number> {
  const [comments, setComments] = useState<Comment[]>([])
  const wsContext = useContext(WebSocketContext)
  const lastCommentUpdate = wsContext?.lastCommentUpdate ?? 0

  useEffect(() => {
    const fetchAll = async (): Promise<void> => {
      try {
        const params = new URLSearchParams()
        if (directory) params.set('directory', directory)
        const response = await fetch(`/api/review/comments?${params.toString()}`)
        if (response.ok) {
          setComments(await response.json() as Comment[])
        }
      } catch (error) {
        console.error('Failed to fetch all comments:', error)
      }
    }
    void fetchAll()
  }, [directory, lastCommentUpdate])

  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of comments) {
      if (c.parentId) continue
      let key = 'working-copy'
      if (c.revision) key = c.revision
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [comments])
}
