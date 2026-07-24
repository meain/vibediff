import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import DiffViewer from './DiffViewer'
import { WebSocketProvider } from '../contexts/WebSocketContext'
import type { FileDiff } from '../types/diff'

// jsdom has no real WebSocket networking; stub it out so useWebSocket's
// `new WebSocket(...)` doesn't throw or try to actually connect.
class FakeWebSocket {
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close(): void { /* no-op */ }
}
vi.stubGlobal('WebSocket', FakeWebSocket)

// react-resizable-panels' <Group>/<Panel> observe their own size via
// ResizeObserver, which jsdom doesn't implement.
class FakeResizeObserver {
  observe(): void { /* no-op */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver)

const localStorageMock: Storage = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(() => null),
  length: 0,
}
vi.stubGlobal('localStorage', localStorageMock)

vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})))

function makeFile(path: string): FileDiff {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: '@@ -1 +1 @@',
        lines: [
          { type: 'delete', oldNumber: 1, content: 'old' },
          { type: 'add', newNumber: 1, content: 'new' },
        ],
      },
    ],
  }
}

const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')]

function assertNotNull<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected non-null value')
  return value
}

function jsonResponse(body: unknown, ok = true): { ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> } {
  return { ok, json: async () => body, text: async () => JSON.stringify(body) }
}

function buildFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const u = url
    if (u.includes('/api/directories')) return Promise.resolve(jsonResponse([{ path: '/repo' }]))
    if (u.includes('/api/config')) return Promise.resolve(jsonResponse({ homeDir: '/home' }))
    if (u.includes('/api/directory?')) return Promise.resolve(jsonResponse({ directory: '/repo', backend: 'git' }))
    if (u.includes('/api/diff')) return Promise.resolve(jsonResponse({ files, type: 'all' }))
    if (u.includes('/api/revisions')) return Promise.resolve(jsonResponse([]))
    if (u.includes('/api/review/comments')) return Promise.resolve(jsonResponse([]))
    return Promise.resolve(jsonResponse({}))
  })
}

describe('DiffViewer - command palette / selected-file sync', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', buildFetchMock())
    // DiffViewer syncs selectedFile/directory/revision into the URL via
    // history.replaceState, which — unlike component state — persists across
    // tests in the same jsdom environment. Reset it so each test starts fresh.
    window.history.replaceState(null, '', '/')
  })

  async function renderViewer(): Promise<void> {
    render(
      <WebSocketProvider>
        <DiffViewer />
      </WebSocketProvider>
    )
    await waitFor(() => { expect(sidebarRow('a.txt')).toBeInTheDocument() })
  }

  function typeInPalette(text: string): void {
    fireEvent.change(screen.getByPlaceholderText('Type a command or search…'), { target: { value: text } })
  }

  // The file path text appears both in the sidebar FileList row (span.flex-1)
  // and in the single-file view's header (span.text-sm.font-semibold) — scope
  // assertions to the sidebar occurrence specifically.
  function sidebarRow(path: string): HTMLElement {
    const matches = screen.getAllByText(path)
    const row = matches.find(el => el.className.includes('flex-1 min-w-0'))
    if (!row) throw new Error(`sidebar row for ${path} not found`)
    return row
  }

  it('auto-advances selectedFile after marking reviewed via the command palette, and the palette reflects it on reopen', async () => {
    await renderViewer()

    // Sidebar should show "a.txt" as the highlighted/selected file initially.
    expect(sidebarRow('a.txt').closest('div')).toHaveClass('bg-accent-muted')

    // Open command palette, mark current file (a.txt) reviewed.
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.getByPlaceholderText('Type a command or search…')).toBeInTheDocument()

    typeInPalette('Mark as reviewed')
    const markItem = await screen.findByText('Mark as reviewed')
    fireEvent.click(markItem)

    // Palette should have closed.
    await waitFor(() => { expect(screen.queryByPlaceholderText('Type a command or search…')).not.toBeInTheDocument() })

    // selectedFile should now be b.txt (the next file after a.txt), reflected in the sidebar highlight.
    await waitFor(() => {
      expect(sidebarRow('b.txt').closest('div')).toHaveClass('bg-accent-muted')
    })

    // Reopen the command palette: it should now offer to mark b.txt (not a.txt) as reviewed.
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    typeInPalette('Mark as reviewed')
    const markItem2 = await screen.findByText('Mark as reviewed')
    // The description under the label shows the target file path.
    const labelWrapper = assertNotNull(markItem2.parentElement)
    expect(within(labelWrapper).getByText('b.txt')).toBeInTheDocument()
  })

  it('updates the shared selectedFile state when picking a file via the command palette "Select file…" submenu', async () => {
    await renderViewer()

    expect(sidebarRow('a.txt').closest('div')).toHaveClass('bg-accent-muted')

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    typeInPalette('Select file')
    const selectFileItem = await screen.findByText('Select file…')
    fireEvent.click(selectFileItem)

    const cFileOption = await screen.findByRole('button', { name: /c\.txt/ })
    fireEvent.click(cFileOption)

    await waitFor(() => { expect(screen.queryByPlaceholderText('Type a command or search…')).not.toBeInTheDocument() })

    // The sidebar's selected-file highlight should move to c.txt.
    await waitFor(() => {
      expect(sidebarRow('c.txt').closest('div')).toHaveClass('bg-accent-muted')
    })
    // a.txt should no longer be highlighted.
    expect(sidebarRow('a.txt').closest('div')).not.toHaveClass('bg-accent-muted')
  })
})
