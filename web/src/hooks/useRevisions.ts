import { useState, useEffect, useCallback } from 'react'
import type { Revision } from '../types/diff'

interface UseRevisionsReturn {
  revisions: Revision[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useRevisions(directory: string): UseRevisionsReturn {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRevisions = useCallback(async (showLoading = true): Promise<void> => {
    if (!directory) return
    try {
      if (showLoading) {
        setLoading(true)
      }
      const params = new URLSearchParams()
      params.set('directory', directory)
      params.set('limit', '50')
      const response = await fetch(`/api/revisions?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch revisions')
      }
      const result = await response.json() as Revision[]
      setRevisions(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }, [directory])

  useEffect(() => {
    void fetchRevisions(true)
  }, [fetchRevisions])

  const refetch = useCallback((): void => {
    void fetchRevisions(false)
  }, [fetchRevisions])

  return { revisions, loading, error, refetch }
}
