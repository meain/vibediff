import { useState, useEffect, useCallback } from 'react'
import type { VCSBackend } from '../types/diff'

interface DirectoryInfo {
  directory: string
  backend: VCSBackend
}

interface UseDirectoryReturn {
  currentDirectory: string
  backend: VCSBackend
  directories: string[]
  loading: boolean
  error: string | null
  setCurrentDirectory: (dir: string) => void
  registerDirectory: (dir: string) => Promise<void>
  removeDirectory: (dir: string) => Promise<void>
  validateDirectory: (dir: string) => Promise<{ valid: boolean; error?: string }>
}

export function useDirectory(): UseDirectoryReturn {
  const [directories, setDirectories] = useState<string[]>([])
  const [currentDirectory, setCurrentDirectoryState] = useState<string>('')
  const [backend, setBackend] = useState<VCSBackend>('git')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDirectories = useCallback(async (): Promise<string[]> => {
    try {
      const resp = await fetch('/api/directories')
      if (!resp.ok) throw new Error('Failed to fetch directories')
      const dirs = await resp.json() as string[]
      setDirectories(dirs)
      return dirs
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return []
    }
  }, [])

  const fetchBackend = useCallback(async (dir: string): Promise<void> => {
    if (!dir) return
    try {
      const resp = await fetch(`/api/directory?directory=${encodeURIComponent(dir)}`)
      if (!resp.ok) return
      const data = await resp.json() as DirectoryInfo
      if (data.backend) setBackend(data.backend)
    } catch {
      // ignore — backend label is cosmetic
    }
  }, [])

  // On mount: load directories, restore last-used dir (falling back to first in list)
  useEffect(() => {
    void (async () => {
      const dirs = await fetchDirectories()
      if (dirs.length === 0) return
      const saved = localStorage.getItem('lastDirectory')
      setCurrentDirectoryState(saved && dirs.includes(saved) ? saved : dirs[0])
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch backend info whenever the current directory changes
  useEffect(() => {
    void fetchBackend(currentDirectory)
  }, [currentDirectory, fetchBackend])

  const setCurrentDirectory = useCallback((dir: string) => {
    localStorage.setItem('lastDirectory', dir)
    setCurrentDirectoryState(dir)
  }, [])

  const registerDirectory = useCallback(async (dir: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/directories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: dir })
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(text.trim() || 'Failed to register directory')
      }
      const data = await resp.json() as DirectoryInfo
      if (data.backend) setBackend(data.backend)
      await fetchDirectories()
      localStorage.setItem('lastDirectory', dir)
      setCurrentDirectoryState(dir)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    } finally {
      setLoading(false)
    }
  }, [fetchDirectories])

  const removeDirectory = useCallback(async (dir: string): Promise<void> => {
    const resp = await fetch(`/api/directories/${encodeURIComponent(dir)}`, { method: 'DELETE' })
    if (!resp.ok) throw new Error('Failed to remove directory')
    const dirs = await fetchDirectories()
    if (currentDirectory === dir) {
      setCurrentDirectoryState(dirs.length > 0 ? dirs[0] : '')
    }
  }, [currentDirectory, fetchDirectories])

  const validateDirectory = useCallback(async (dir: string): Promise<{ valid: boolean; error?: string }> => {
    try {
      const resp = await fetch('/api/directories/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: dir })
      })
      if (!resp.ok) throw new Error('Validation request failed')
      return await resp.json() as { valid: boolean; error?: string }
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }, [])

  return {
    currentDirectory,
    backend,
    directories,
    loading,
    error,
    setCurrentDirectory,
    registerDirectory,
    removeDirectory,
    validateDirectory,
  }
}
