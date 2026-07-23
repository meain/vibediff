import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDirectory } from './useDirectory'

// Mock fetch globally, same pattern as useComments.test.ts
const mockFetch = vi.fn()
global.fetch = mockFetch

// jsdom in this environment doesn't expose window.localStorage, which lets
// Node's own (file-backed) localStorage global leak through and throw. The
// hook reads/writes 'lastDirectory' via localStorage as an implementation
// detail unrelated to aliasing, so stub it out to keep test output clean.
const localStorageMock: Storage = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(() => null),
  length: 0,
}
vi.stubGlobal('localStorage', localStorageMock)

function jsonResponse(body: unknown, ok = true): { ok: boolean; json: () => Promise<unknown> } {
  return { ok, json: async () => body }
}

/**
 * Builds a fetch mock that:
 *  - answers every GET to /api/directories with `initialEntries` the first
 *    time, and `afterEntries` every time after (i.e. after a refetch caused
 *    by a mutation).
 *  - answers PATCH/PUT/DELETE to any endpoint with an empty ok response.
 *  - answers anything else (backend, homeDir, validate, ...) with an empty
 *    ok response so the hook's other initial fetches don't blow up.
 */
function buildFetchMock(
  initialEntries: Array<{ path: string; alias: string }>,
  afterEntries: Array<{ path: string; alias: string }>
): ReturnType<typeof vi.fn> {
  let directoriesGetCount = 0
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const u = String(url)

    if (method !== 'GET') {
      return Promise.resolve(jsonResponse({}))
    }

    if (u.includes('/api/directories') && !u.includes('validate')) {
      directoriesGetCount += 1
      return Promise.resolve(jsonResponse(directoriesGetCount === 1 ? initialEntries : afterEntries))
    }

    return Promise.resolve(jsonResponse({}))
  })
}

describe('useDirectory - setAlias', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PATCHes the alias endpoint with a URL-encoded path and {alias} JSON body, then refetches the directory list', async () => {
    const initialEntries = [{ path: '/home/u/proj', alias: '' }]
    const afterEntries = [{ path: '/home/u/proj', alias: 'Proj A' }]
    mockFetch.mockImplementation(buildFetchMock(initialEntries, afterEntries))

    const { result } = renderHook(() => useDirectory())

    await waitFor(() => {
      expect(result.current.directories).toEqual(initialEntries)
    })

    await act(async () => {
      await result.current.setAlias('/home/u/proj', 'Proj A')
    })

    const patchCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patchCall).toBeDefined()
    const [patchUrl, patchInit] = patchCall as [string, RequestInit]

    expect(String(patchUrl)).toContain(encodeURIComponent('/home/u/proj'))
    expect(patchInit.method).toBe('PATCH')
    expect(JSON.parse(String(patchInit.body))).toEqual({ alias: 'Proj A' })

    // A refetch of the directory list must follow the mutation (same
    // pattern as removeDirectory, per the plan).
    const directoryGetCalls = mockFetch.mock.calls.filter((c) => {
      const method = (c[1] as RequestInit | undefined)?.method ?? 'GET'
      return method === 'GET' && String(c[0]).includes('/api/directories') && !String(c[0]).includes('validate')
    })
    expect(directoryGetCalls.length).toBeGreaterThanOrEqual(2)

    await waitFor(() => {
      expect(result.current.directories).toEqual(afterEntries)
    })
  })

  it('clearing an alias PATCHes {alias: ""} and the refetched entry reverts to showing no alias', async () => {
    const initialEntries = [{ path: '/home/u/proj', alias: 'Proj A' }]
    const afterEntries = [{ path: '/home/u/proj', alias: '' }]
    mockFetch.mockImplementation(buildFetchMock(initialEntries, afterEntries))

    const { result } = renderHook(() => useDirectory())

    await waitFor(() => {
      expect(result.current.directories).toEqual(initialEntries)
    })

    await act(async () => {
      await result.current.setAlias('/home/u/proj', '')
    })

    const patchCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patchCall).toBeDefined()
    const [, patchInit] = patchCall as [string, RequestInit]
    expect(JSON.parse(String(patchInit.body))).toEqual({ alias: '' })

    await waitFor(() => {
      expect(result.current.directories).toEqual(afterEntries)
    })
  })
})

describe('useDirectory - setAlias error path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when the PATCH response is not ok, and does not refetch directories or set the hook error state', async () => {
    const initialEntries = [{ path: '/home/u/proj', alias: '' }]
    let directoriesGetCount = 0
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const u = url

      if (method === 'PATCH') {
        return Promise.resolve(jsonResponse({}, false))
      }
      if (u.includes('/api/directories') && !u.includes('validate')) {
        directoriesGetCount += 1
        return Promise.resolve(jsonResponse(initialEntries))
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { result } = renderHook(() => useDirectory())

    await waitFor(() => {
      expect(result.current.directories).toEqual(initialEntries)
    })
    const getCountAfterMount = directoriesGetCount

    await expect(
      act(async () => {
        await result.current.setAlias('/home/u/proj', 'Nope')
      })
    ).rejects.toThrow('Failed to set alias')

    // The PATCH failure must not trigger the post-mutation refetch that a
    // successful setAlias does (see the passing test above).
    expect(directoriesGetCount).toBe(getCountAfterMount)
    expect(result.current.directories).toEqual(initialEntries)
    // Unlike registerDirectory, setAlias has no try/catch -- it just throws
    // the raw Error and never touches the hook's `error` state.
    expect(result.current.error).toBeNull()
  })
})

describe('useDirectory - reorderDirectories preserves aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reindexes entries via the refetch without dropping their alias data', async () => {
    const initialEntries = [
      { path: '/a/b', alias: 'Foo' },
      { path: '/c/d', alias: '' },
    ]
    const reorderedEntries = [
      { path: '/c/d', alias: '' },
      { path: '/a/b', alias: 'Foo' },
    ]
    mockFetch.mockImplementation(buildFetchMock(initialEntries, reorderedEntries))

    const { result } = renderHook(() => useDirectory())

    await waitFor(() => {
      expect(result.current.directories).toEqual(initialEntries)
    })

    await act(async () => {
      await result.current.reorderDirectories(['/c/d', '/a/b'])
    })

    await waitFor(() => {
      expect(result.current.directories).toEqual(reorderedEntries)
    })

    const aliased = result.current.directories.find((d) => d.path === '/a/b')
    expect(aliased?.alias).toBe('Foo')
    expect(result.current.directories.map((d) => d.path)).toEqual(['/c/d', '/a/b'])
  })
})
