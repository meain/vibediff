import { useState, useEffect, useCallback, useRef } from 'react'
import type { FileDiff } from '../types/diff'
import { computeFileHash } from '../utils/hashUtils'
import { loadReviewedFiles, saveReviewedFiles } from '../utils/reviewStorage'

/**
 * Custom hook for managing reviewed files with hash-based validation
 * and multi-project / per-revision persistence.
 *
 * Reviewed state is scoped to a (projectPath, revision) pair so switching
 * between commits or directories shows the correct marks for each context.
 */
export function useReviewedFiles(projectPath: string, selectedRevision?: string | null) {
  // Composite key that uniquely identifies the (project, revision) context.
  // null/undefined selectedRevision means the working-copy view.
  const storageKey = `${projectPath}::${selectedRevision ?? 'working-copy'}`

  // Store hashes internally but expose a Set of paths for compatibility
  const [reviewedHashes, setReviewedHashes] = useState<Map<string, string>>(new Map())
  const [reviewedPaths, setReviewedPaths] = useState<Set<string>>(new Set())

  // When the storage key changes both the load and save effects fire in the
  // same flush. Without a guard the save effect runs first with the previous
  // render's stale hashes and writes them to the new key, corrupting data for
  // every revision the user visits. The flag lets the save effect know it
  // should skip that one run and wait for the subsequent re-render that carries
  // the freshly-loaded hashes.
  const justLoadedRef = useRef(false)

  // Load reviewed files when project or revision changes
  useEffect(() => {
    justLoadedRef.current = true
    const loaded = loadReviewedFiles(storageKey)
    setReviewedHashes(loaded)
    setReviewedPaths(new Set(loaded.keys()))
  }, [storageKey])

  // Save to storage whenever hashes change, but skip the run that was triggered
  // by the key change itself (load effect sets the flag for that case).
  useEffect(() => {
    if (justLoadedRef.current) {
      justLoadedRef.current = false
      return
    }
    saveReviewedFiles(storageKey, reviewedHashes)
  }, [storageKey, reviewedHashes])

  /**
   * Toggle reviewed status for a file
   */
  const toggleReviewed = useCallback((file: FileDiff) => {
    const hash = computeFileHash(file)

    setReviewedHashes(prev => {
      const newMap = new Map(prev)

      if (newMap.has(file.path)) {
        // Already reviewed, unmark it
        newMap.delete(file.path)
      } else {
        // Not reviewed, mark it with current hash
        newMap.set(file.path, hash)
      }

      return newMap
    })

    setReviewedPaths(prev => {
      const newSet = new Set(prev)
      if (newSet.has(file.path)) {
        newSet.delete(file.path)
      } else {
        newSet.add(file.path)
      }
      return newSet
    })
  }, [])

  /**
   * Clear all reviewed marks
   */
  const clearReviewed = useCallback(() => {
    setReviewedHashes(new Map())
    setReviewedPaths(new Set())
  }, [])

  /**
   * Validate reviewed files against current diff data
   * Clears reviewed marks for files whose content has changed
   */
  const validateReviewed = useCallback((files: FileDiff[]) => {
    let hasChanges = false

    setReviewedHashes(prev => {
      const newMap = new Map(prev)

      for (const file of files) {
        const storedHash = prev.get(file.path)
        if (storedHash) {
          const currentHash = computeFileHash(file)

          // If hashes don't match, clear the reviewed mark
          if (storedHash !== currentHash) {
            newMap.delete(file.path)
            hasChanges = true
          }
        }
      }

      return hasChanges ? newMap : prev
    })

    if (hasChanges) {
      setReviewedPaths(prev => {
        const newSet = new Set(prev)
        for (const file of files) {
          const storedHash = reviewedHashes.get(file.path)
          if (storedHash) {
            const currentHash = computeFileHash(file)
            if (storedHash !== currentHash) {
              newSet.delete(file.path)
            }
          }
        }
        return newSet
      })
    }
  }, [reviewedHashes])

  return {
    reviewedFiles: reviewedPaths,
    toggleReviewed,
    clearReviewed,
    validateReviewed
  }
}
