import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'reviewedRevisions'

function load(projectPath: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const data = JSON.parse(raw) as Record<string, string[]>
    return new Set(data[projectPath] ?? [])
  } catch {
    return new Set()
  }
}

function save(projectPath: string, revisions: Set<string>): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data: Record<string, string[]> = raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
    if (revisions.size === 0) {
      delete data[projectPath]
    } else {
      data[projectPath] = [...revisions]
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore storage errors
  }
}

/**
 * Tracks which revisions (commits) have been fully reviewed for a project.
 * A revision is considered fully reviewed when every file in its diff has
 * been marked reviewed. Stored in localStorage keyed by projectPath.
 *
 * Revision IDs match those used in useReviewedFiles: the actual revision ID
 * for named commits, or the sentinel string 'working-copy' for the
 * unstaged/working-copy diff.
 */
export function useReviewedRevisions(projectPath: string) {
  const [reviewedRevisions, setReviewedRevisions] = useState<Set<string>>(() => load(projectPath))

  // Reload when project changes
  useEffect(() => {
    setReviewedRevisions(load(projectPath))
  }, [projectPath])

  const markRevisionReviewed = useCallback((revisionId: string) => {
    setReviewedRevisions(prev => {
      if (prev.has(revisionId)) return prev
      const next = new Set(prev)
      next.add(revisionId)
      save(projectPath, next)
      return next
    })
  }, [projectPath])

  const unmarkRevisionReviewed = useCallback((revisionId: string) => {
    setReviewedRevisions(prev => {
      if (!prev.has(revisionId)) return prev
      const next = new Set(prev)
      next.delete(revisionId)
      save(projectPath, next)
      return next
    })
  }, [projectPath])

  return { reviewedRevisions, markRevisionReviewed, unmarkRevisionReviewed }
}
