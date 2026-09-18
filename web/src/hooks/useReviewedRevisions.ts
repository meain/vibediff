import { useState, useCallback, useEffect, useMemo } from 'react'

const STORAGE_KEY = 'reviewedRevisionsV2'
const LEGACY_STORAGE_KEY = 'reviewedRevisions'

/** revisionId -> content hash the revision had when it was marked reviewed. */
type ReviewedMap = Record<string, string>

function load(projectPath: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as Record<string, ReviewedMap>
      return new Map(Object.entries(data[projectPath] ?? {}))
    }

    // Migrate the old hash-less format (projectPath -> revisionId[]). Marks
    // are kept but get an empty hash, so the first validation against a real
    // hash clears them and forces a re-review.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacy) return new Map()
    const legacyData = JSON.parse(legacy) as Record<string, string[]>
    const migrated: Record<string, ReviewedMap> = {}
    for (const [path, ids] of Object.entries(legacyData)) {
      migrated[path] = Object.fromEntries(ids.map(id => [id, '']))
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    return new Map(Object.entries(migrated[projectPath] ?? {}))
  } catch {
    return new Map()
  }
}

function save(projectPath: string, revisions: Map<string, string>): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data: Record<string, ReviewedMap> = raw ? (JSON.parse(raw) as Record<string, ReviewedMap>) : {}
    if (revisions.size === 0) {
      delete data[projectPath]
    } else {
      data[projectPath] = Object.fromEntries(revisions)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore storage errors
  }
}

/**
 * Tracks which revisions (commits) have been marked reviewed for a project,
 * along with the content hash each revision had at the time it was marked.
 *
 * A mark is sticky: it survives navigation, reloads, and changes to the
 * per-file reviewed marks. It is only cleared when the user unchecks it or
 * when the revision's content hash changes (amend, rebase, new working-copy
 * snapshot), which is what `validateRevisions` detects.
 *
 * Revision IDs match those used in useReviewedFiles: the actual revision ID
 * for named commits, or the sentinel string 'working-copy' for the
 * unstaged/working-copy diff.
 */
export function useReviewedRevisions(projectPath: string) {
  const [reviewedHashes, setReviewedHashes] = useState<Map<string, string>>(() => load(projectPath))

  // Reload when project changes
  useEffect(() => {
    setReviewedHashes(load(projectPath))
  }, [projectPath])

  const reviewedRevisions = useMemo(() => new Set(reviewedHashes.keys()), [reviewedHashes])

  const markRevisionReviewed = useCallback((revisionId: string, hash: string) => {
    setReviewedHashes(prev => {
      if (prev.get(revisionId) === hash) return prev
      const next = new Map(prev)
      next.set(revisionId, hash)
      save(projectPath, next)
      return next
    })
  }, [projectPath])

  const unmarkRevisionReviewed = useCallback((revisionId: string) => {
    setReviewedHashes(prev => {
      if (!prev.has(revisionId)) return prev
      const next = new Map(prev)
      next.delete(revisionId)
      save(projectPath, next)
      return next
    })
  }, [projectPath])

  const toggleRevisionReviewed = useCallback((revisionId: string, hash: string) => {
    setReviewedHashes(prev => {
      const next = new Map(prev)
      if (next.has(revisionId)) {
        next.delete(revisionId)
      } else {
        next.set(revisionId, hash)
      }
      save(projectPath, next)
      return next
    })
  }, [projectPath])

  /**
   * Clear marks whose stored hash no longer matches the revision's current
   * content hash. Revisions missing from `currentHashes` (e.g. commits outside
   * the fetched log window) are left untouched — we only reset on a confirmed
   * mismatch. An empty stored hash means the baseline wasn't known when the
   * mark was made (migrated entry, or the git working copy marked while a
   * different revision was being viewed); such entries adopt the first hash we
   * learn instead of being dropped.
   */
  const validateRevisions = useCallback((currentHashes: Map<string, string>) => {
    setReviewedHashes(prev => {
      let changed = false
      const next = new Map(prev)
      for (const [revisionId, storedHash] of prev) {
        const currentHash = currentHashes.get(revisionId)
        if (!currentHash || storedHash === currentHash) continue
        if (storedHash === '') {
          next.set(revisionId, currentHash)
        } else {
          next.delete(revisionId)
        }
        changed = true
      }
      if (!changed) return prev
      save(projectPath, next)
      return next
    })
  }, [projectPath])

  return {
    reviewedRevisions,
    markRevisionReviewed,
    unmarkRevisionReviewed,
    toggleRevisionReviewed,
    validateRevisions,
  }
}
