import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import FileDiff from './FileDiff'
import type { FileDiff as FileDiffType, DiffLine as DiffLineType, Comment } from '../types/diff'

// ---- fixture builders -------------------------------------------------

function makeLines(start: number, end: number): DiffLineType[] {
  const lines: DiffLineType[] = []
  for (let n = start; n <= end; n++) {
    lines.push({ type: 'normal', oldLineNumber: n, newLineNumber: n, content: `line ${String(n)}` })
  }
  return lines
}

/**
 * Two-hunk file used for tests 1-5:
 *   - hunk A: lines 10-15 (visible)
 *   - gap:    lines 16-49 hidden (34 lines) -- also a leading gap of 9 lines (1-9)
 *   - hunk B: lines 50-55 (visible)
 */
function buildMainFile(): FileDiffType {
  return {
    path: 'foo.go',
    status: 'modified',
    additions: 0,
    deletions: 0,
    hunks: [
      { oldStart: 10, oldLines: 6, newStart: 10, newLines: 6, header: '@@ -10,6 +10,6 @@', lines: makeLines(10, 15) },
      { oldStart: 50, oldLines: 6, newStart: 50, newLines: 6, header: '@@ -50,6 +50,6 @@', lines: makeLines(50, 55) },
    ],
  }
}

function buildMainFullFile(): FileDiffType {
  return {
    path: 'foo.go',
    status: 'modified',
    additions: 0,
    deletions: 0,
    hunks: [
      { oldStart: 1, oldLines: 100, newStart: 1, newLines: 100, header: '@@ -1,100 +1,100 @@', lines: makeLines(1, 100) },
    ],
  }
}

function baseProps(file: FileDiffType, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file,
    viewMode: 'unified' as const,
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onAddComment: vi.fn(),
    onViewFullFile: vi.fn(),
    getCommentsForLine: (): Comment[] => [],
    onDeleteComment: vi.fn(async () => undefined),
    ...overrides,
  }
}

function stubFetch(response: FileDiffType): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => response,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// ---- DOM helpers -------------------------------------------------------

/** Finds the row for a given (already-rendered) line number, or null if not rendered. */
function queryLineRow(lineNumber: number): HTMLElement | null {
  const matches = screen.queryAllByText(String(lineNumber)).filter((el) => el.tagName === 'TD')
  if (matches.length === 0) return null
  return matches[0].closest('tr') as HTMLElement
}

function getLineRow(lineNumber: number): HTMLElement {
  const row = queryLineRow(lineNumber)
  if (!row) throw new Error(`No row rendered for line ${String(lineNumber)}`)
  return row
}

function getAddCommentButton(lineNumber: number): HTMLElement {
  return within(getLineRow(lineNumber)).getByLabelText('Add comment')
}

/** Finds a rendered CommentDisplay card by its `data-comment-id` attribute. */
function getCommentCard(commentId: string): HTMLElement {
  const node = document.querySelector(`[data-comment-id="${commentId}"]`)
  if (!(node instanceof HTMLElement)) {
    throw new Error(`No comment card rendered for id "${commentId}"`)
  }
  return node
}

/**
 * Locates the container for a gap's "expand" banner by matching its exact
 * "{N} lines hidden" label text, then walking up to the nearest ancestor
 * that also contains the expand/collapse buttons.
 */
function scopeFromHiddenLabel(hiddenLabel: string): HTMLElement {
  const el = screen.getByText((content) => content.trim() === hiddenLabel)
  let node: HTMLElement | null = el.closest('tr') as HTMLElement | null
  if (!node) {
    node = el.parentElement
    while (node && !node.querySelector('button')) {
      node = node.parentElement
    }
  }
  if (!node) throw new Error(`Unable to locate banner container for "${hiddenLabel}"`)
  return node
}

// ---- tests --------------------------------------------------------------

describe('FileDiff hidden-line expansion', () => {
  it('1. lets you add a comment on a line revealed by Expand down', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const onAddComment = vi.fn()

    render(<FileDiff {...baseProps(file, { onAddComment })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(20)).not.toBeNull()
    })

    const addBtn = getAddCommentButton(20)
    fireEvent.mouseDown(addBtn)
    fireEvent.mouseUp(document)

    expect(onAddComment).toHaveBeenCalledWith(20, 20)
  })

  it('2. supports a drag-select fully inside expanded lines', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const onAddComment = vi.fn()

    render(<FileDiff {...baseProps(file, { onAddComment })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(22)).not.toBeNull()
    })

    fireEvent.mouseDown(getAddCommentButton(18))
    fireEvent.mouseEnter(getLineRow(22))
    fireEvent.mouseUp(document)

    expect(onAddComment).toHaveBeenCalledWith(18, 22)
  })

  it('3. supports a drag range spanning from a hunk line into an expanded line', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const onAddComment = vi.fn()

    render(<FileDiff {...baseProps(file, { onAddComment })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(20)).not.toBeNull()
    })

    fireEvent.mouseDown(getAddCommentButton(15))
    fireEvent.mouseEnter(getLineRow(20))
    fireEvent.mouseUp(document)

    expect(onAddComment).toHaveBeenCalledWith(15, 20)
  })

  it('4. renders a comment anchored to a hidden line only once it is revealed', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const getCommentsForLine = (_file: string, line: number): Comment[] =>
      line === 20
        ? [
            {
              id: 'c1',
              file: 'foo.go',
              line: 20,
              lineEnd: 20,
              content: 'existing comment text',
              author: 'user',
              status: 'open',
              createdAt: '2026-01-01T00:00:00Z',
            },
          ]
        : []

    render(<FileDiff {...baseProps(file, { getCommentsForLine })} />)

    expect(screen.queryByText('existing comment text')).not.toBeInTheDocument()

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(screen.getByText('existing comment text')).toBeInTheDocument()
    })
  })

  it('5. keeps a hidden line non-interactive before any expansion', () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())

    render(<FileDiff {...baseProps(file)} />)

    expect(queryLineRow(20)).toBeNull()
    expect(
      screen.getByText((content) => content.includes('34') && content.includes('lines hidden'))
    ).toBeInTheDocument()
  })

  it('6. Expand all reveals every hidden line in the gap in one click', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [
        { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) },
        { oldStart: 14, oldLines: 3, newStart: 14, newLines: 3, header: '@@ -14,3 +14,3 @@', lines: makeLines(14, 16) },
      ],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 16, newStart: 1, newLines: 16, header: '@@ -1,16 +1,16 @@', lines: makeLines(1, 16) }],
    }
    stubFetch(fullFile)

    render(<FileDiff {...baseProps(file)} />)

    const banner = scopeFromHiddenLabel('8 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '⇕ Expand all' }))

    await waitFor(() => {
      for (let n = 6; n <= 13; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })

    expect(screen.queryByText((content) => content.includes('lines hidden'))).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: '↓ Expand down' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: '↑ Expand up' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: '⇕ Expand all' })).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Collapse' })).toHaveLength(1)
  })

  it('7. Expand all on a partially-expanded gap reveals the rest', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [
        { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) },
        { oldStart: 31, oldLines: 3, newStart: 31, newLines: 3, header: '@@ -31,3 +31,3 @@', lines: makeLines(31, 33) },
      ],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 33, newStart: 1, newLines: 33, header: '@@ -1,33 +1,33 @@', lines: makeLines(1, 33) }],
    }
    stubFetch(fullFile)

    render(<FileDiff {...baseProps(file)} />)

    const banner = scopeFromHiddenLabel('25 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(15)).not.toBeNull()
    })

    fireEvent.click(within(banner).getByRole('button', { name: '⇕ Expand all' }))

    await waitFor(() => {
      for (let n = 16; n <= 30; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })

    expect(screen.queryByText((content) => content.includes('lines hidden'))).not.toBeInTheDocument()
  })

  it('8. Expand all fetches first for the trailing unknown-count gap', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) }],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 20, newStart: 1, newLines: 20, header: '@@ -1,20 +1,20 @@', lines: makeLines(1, 20) }],
    }
    const fetchMock = stubFetch(fullFile)

    render(<FileDiff {...baseProps(file)} />)

    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '⇕ Expand all' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('/api/diff/')
    expect(calledUrl).toContain(encodeURIComponent('foo.go'))

    await waitFor(() => {
      for (let n = 6; n <= 20; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })
  })

  it('9. Collapse after Expand all fully restores the hidden state', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [
        { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) },
        { oldStart: 14, oldLines: 3, newStart: 14, newLines: 3, header: '@@ -14,3 +14,3 @@', lines: makeLines(14, 16) },
      ],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 16, newStart: 1, newLines: 16, header: '@@ -1,16 +1,16 @@', lines: makeLines(1, 16) }],
    }
    stubFetch(fullFile)

    render(<FileDiff {...baseProps(file)} />)

    const banner = scopeFromHiddenLabel('8 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '⇕ Expand all' }))

    await waitFor(() => {
      for (let n = 6; n <= 13; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })

    fireEvent.click(within(banner).getByRole('button', { name: 'Collapse' }))

    await waitFor(() => {
      for (let n = 6; n <= 13; n++) {
        expect(queryLineRow(n)).toBeNull()
      }
    })

    expect(screen.getByText((content) => content.trim() === '8 lines hidden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '↓ Expand down' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '↑ Expand up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '⇕ Expand all' })).toBeInTheDocument()
  })
})

// ---- Phase 3b additions --------------------------------------------------
//
// Gaps left by Phase 3a: split view is completely untested (renderSplitView's
// keyPrefix param exists specifically to prevent React key collisions across
// hunk lines / gap-top lines / gap-bottom lines rendered as siblings), the
// leading gap's asymmetric button gating (no "Expand down" before the first
// hunk) is unconfirmed, getCommentRangeLines' lineOrder extension into
// expanded lines is unconfirmed, and the reply/resolve/reopen/inline-form
// wiring on expanded lines was only checked for text presence, not for
// actually firing callbacks.

/**
 * Split view renders each context/normal line's DiffLine fragment twice
 * (once per side, since context lines are identical left/right), so a given
 * line number appears twice in the row. queryLineRow/getLineRow already
 * tolerate this (they take the first match), but getByLabelText for "Add
 * comment" would ambiguously match both duplicated buttons in the row --
 * this helper picks the first one, which is functionally equivalent since
 * both fire the same onDragStart(lineNumber) handler.
 */
function getFirstAddCommentButton(lineNumber: number): HTMLElement {
  return within(getLineRow(lineNumber)).getAllByLabelText('Add comment')[0]
}

describe('FileDiff hidden-line expansion -- split view & wiring gaps (Phase 3b)', () => {
  it('10. split view: lets you add a comment on a line revealed by Expand down', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const onAddComment = vi.fn()

    render(<FileDiff {...baseProps(file, { viewMode: 'split', onAddComment })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(20)).not.toBeNull()
    })

    const addBtn = getFirstAddCommentButton(20)
    fireEvent.mouseDown(addBtn)
    fireEvent.mouseUp(document)

    expect(onAddComment).toHaveBeenCalledWith(20, 20)
  })

  it('11. split view: drag-select does not extend the range across rows, unlike unified view (documents a real gap)', async () => {
    // DiffLine's split-view branch (viewMode === 'split') never attaches
    // onMouseEnter/onMouseLeave to its <td> elements -- those are only wired
    // on the <tr> in the unified-view branch. renderSplitView's own <tr>
    // wrappers (FileDiff.tsx) also carry no mouse handlers. So in split view,
    // handleDragEnter is never invoked while dragging across rows, and the
    // range collapses to the line where the drag started. This test locks in
    // that actual (not the unified-view-parity one might assume) behavior.
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const onAddComment = vi.fn()

    render(<FileDiff {...baseProps(file, { viewMode: 'split', onAddComment })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(20)).not.toBeNull()
    })

    fireEvent.mouseDown(getFirstAddCommentButton(15))
    fireEvent.mouseEnter(getLineRow(20))
    fireEvent.mouseUp(document)

    expect(onAddComment).toHaveBeenCalledWith(15, 15)
  })

  it('12. split view: full Expand-all across multiple gaps never triggers a React duplicate-key warning', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const file: FileDiffType = {
        path: 'foo.go',
        status: 'modified',
        additions: 0,
        deletions: 0,
        hunks: [
          { oldStart: 20, oldLines: 6, newStart: 20, newLines: 6, header: '@@ -20,6 +20,6 @@', lines: makeLines(20, 25) },
          { oldStart: 60, oldLines: 6, newStart: 60, newLines: 6, header: '@@ -60,6 +60,6 @@', lines: makeLines(60, 65) },
        ],
      }
      const fullFile: FileDiffType = {
        path: 'foo.go',
        status: 'modified',
        additions: 0,
        deletions: 0,
        hunks: [{ oldStart: 1, oldLines: 100, newStart: 1, newLines: 100, header: '@@ -1,100 +1,100 @@', lines: makeLines(1, 100) }],
      }
      stubFetch(fullFile)

      render(<FileDiff {...baseProps(file, { viewMode: 'split' })} />)

      // Three gaps: leading (1-19), between (26-59), trailing (66-100).
      expect(screen.getAllByRole('button', { name: '⇕ Expand all' })).toHaveLength(3)

      fireEvent.click(screen.getAllByRole('button', { name: '⇕ Expand all' })[0])
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: '⇕ Expand all' })).toHaveLength(2)
      })

      fireEvent.click(screen.getAllByRole('button', { name: '⇕ Expand all' })[0])
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: '⇕ Expand all' })).toHaveLength(1)
      })

      fireEvent.click(screen.getAllByRole('button', { name: '⇕ Expand all' })[0])
      await waitFor(() => {
        expect(screen.queryAllByRole('button', { name: '⇕ Expand all' })).toHaveLength(0)
      })

      // All lines from every gap plus both hunks should now be present.
      for (const n of [1, 19, 26, 59, 100]) {
        expect(queryLineRow(n)).not.toBeNull()
      }

      const keyWarnings = errorSpy.mock.calls.filter((args) =>
        args.some((a) => typeof a === 'string' && /same key|unique "key" prop/i.test(a))
      )
      expect(keyWarnings).toEqual([])
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('13. leading gap only exposes Expand up, and one click reveals lines counting backward from the hunk', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [
        { oldStart: 20, oldLines: 5, newStart: 20, newLines: 5, header: '@@ -20,5 +20,5 @@', lines: makeLines(20, 24) },
      ],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 24, newStart: 1, newLines: 24, header: '@@ -1,24 +1,24 @@', lines: makeLines(1, 24) }],
    }
    stubFetch(fullFile)

    render(<FileDiff {...baseProps(file)} />)

    const banner = scopeFromHiddenLabel('19 lines hidden')
    expect(within(banner).getByRole('button', { name: '↑ Expand up' })).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: '↓ Expand down' })).not.toBeInTheDocument()

    fireEvent.click(within(banner).getByRole('button', { name: '↑ Expand up' }))

    await waitFor(() => {
      for (let n = 10; n <= 19; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })

    for (let n = 1; n <= 9; n++) {
      expect(queryLineRow(n)).toBeNull()
    }
  })

  it('14. getCommentRangeLines is invoked with a lineOrder that has been extended to include newly expanded gap lines', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const getCommentRangeLines = vi.fn((_file: string, _lineOrder: number[]): Set<number> => new Set([14, 15, 16, 17, 18]))

    render(<FileDiff {...baseProps(file, { getCommentRangeLines })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(18)).not.toBeNull()
    })

    const lastCallArgs = getCommentRangeLines.mock.calls[getCommentRangeLines.mock.calls.length - 1]
    const lineOrderArg = lastCallArgs[1]
    expect(lineOrderArg).toEqual(expect.arrayContaining([16, 17, 18]))
  })

  it('15. resolve/reopen callbacks fire for comment threads rendered on an expanded line', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const getCommentsForLine = (_file: string, line: number): Comment[] =>
      line === 20
        ? [
            { id: 'c-open', file: 'foo.go', line: 20, lineEnd: 20, content: 'open comment', author: 'user', status: 'open', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'c-resolved', file: 'foo.go', line: 20, lineEnd: 20, content: 'resolved comment', author: 'user', status: 'resolved', createdAt: '2026-01-02T00:00:00Z' },
          ]
        : []
    const onResolveComment = vi.fn(async () => undefined)
    const onReopenComment = vi.fn(async () => undefined)

    render(<FileDiff {...baseProps(file, { getCommentsForLine, onResolveComment, onReopenComment })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(screen.getByText('open comment')).toBeInTheDocument()
    })

    const openCard = getCommentCard('c-open')
    fireEvent.click(within(openCard).getByTitle('Resolve thread'))
    expect(onResolveComment).toHaveBeenCalledWith('c-open')

    const resolvedCard = getCommentCard('c-resolved')
    fireEvent.click(within(resolvedCard).getByTitle('Reopen thread'))
    expect(onReopenComment).toHaveBeenCalledWith('c-resolved')
  })

  it('16. renders the inline comment-composition form anchored to an expanded line, and not before expansion', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const onSubmitComment = vi.fn()
    const onCancelComment = vi.fn()

    render(<FileDiff {...baseProps(file, {
      activeComment: { line: 20, lineEnd: 20 },
      onSubmitComment,
      onCancelComment,
    })} />)

    expect(screen.queryByPlaceholderText('Leave a comment...')).not.toBeInTheDocument()

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Leave a comment...')).toBeInTheDocument()
    })
    expect(screen.getByText('Line 20')).toBeInTheDocument()
  })

  it('17. split view: Expand all reveals every hidden line in the gap in one click', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [
        { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) },
        { oldStart: 14, oldLines: 3, newStart: 14, newLines: 3, header: '@@ -14,3 +14,3 @@', lines: makeLines(14, 16) },
      ],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 16, newStart: 1, newLines: 16, header: '@@ -1,16 +1,16 @@', lines: makeLines(1, 16) }],
    }
    stubFetch(fullFile)

    render(<FileDiff {...baseProps(file, { viewMode: 'split' })} />)

    const banner = scopeFromHiddenLabel('8 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '⇕ Expand all' }))

    await waitFor(() => {
      for (let n = 6; n <= 13; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })

    expect(screen.queryByText((content) => content.includes('lines hidden'))).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: '↓ Expand down' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: '↑ Expand up' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: '⇕ Expand all' })).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Collapse' })).toHaveLength(1)
  })

  it('18. split view: Expand all on a partially-expanded gap reveals the rest', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [
        { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) },
        { oldStart: 31, oldLines: 3, newStart: 31, newLines: 3, header: '@@ -31,3 +31,3 @@', lines: makeLines(31, 33) },
      ],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 33, newStart: 1, newLines: 33, header: '@@ -1,33 +1,33 @@', lines: makeLines(1, 33) }],
    }
    stubFetch(fullFile)

    render(<FileDiff {...baseProps(file, { viewMode: 'split' })} />)

    const banner = scopeFromHiddenLabel('25 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(queryLineRow(15)).not.toBeNull()
    })

    fireEvent.click(within(banner).getByRole('button', { name: '⇕ Expand all' }))

    await waitFor(() => {
      for (let n = 16; n <= 30; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })

    expect(screen.queryByText((content) => content.includes('lines hidden'))).not.toBeInTheDocument()
  })

  it('19. split view: Expand all fetches first for the trailing unknown-count gap', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) }],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 20, newStart: 1, newLines: 20, header: '@@ -1,20 +1,20 @@', lines: makeLines(1, 20) }],
    }
    const fetchMock = stubFetch(fullFile)

    render(<FileDiff {...baseProps(file, { viewMode: 'split' })} />)

    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '⇕ Expand all' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('/api/diff/')
    expect(calledUrl).toContain(encodeURIComponent('foo.go'))

    await waitFor(() => {
      for (let n = 6; n <= 20; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })
  })

  it('20. split view: Collapse after Expand all fully restores the hidden state', async () => {
    const file: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [
        { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: '@@ -1,5 +1,5 @@', lines: makeLines(1, 5) },
        { oldStart: 14, oldLines: 3, newStart: 14, newLines: 3, header: '@@ -14,3 +14,3 @@', lines: makeLines(14, 16) },
      ],
    }
    const fullFile: FileDiffType = {
      path: 'foo.go',
      status: 'modified',
      additions: 0,
      deletions: 0,
      hunks: [{ oldStart: 1, oldLines: 16, newStart: 1, newLines: 16, header: '@@ -1,16 +1,16 @@', lines: makeLines(1, 16) }],
    }
    stubFetch(fullFile)

    render(<FileDiff {...baseProps(file, { viewMode: 'split' })} />)

    const banner = scopeFromHiddenLabel('8 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '⇕ Expand all' }))

    await waitFor(() => {
      for (let n = 6; n <= 13; n++) {
        expect(queryLineRow(n)).not.toBeNull()
      }
    })

    fireEvent.click(within(banner).getByRole('button', { name: 'Collapse' }))

    await waitFor(() => {
      for (let n = 6; n <= 13; n++) {
        expect(queryLineRow(n)).toBeNull()
      }
    })

    expect(screen.getByText((content) => content.trim() === '8 lines hidden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '↓ Expand down' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '↑ Expand up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '⇕ Expand all' })).toBeInTheDocument()
  })

  it('21. split view: renders a comment anchored to a hidden line only once it is revealed', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const getCommentsForLine = (_file: string, line: number): Comment[] =>
      line === 20
        ? [
            {
              id: 'c1',
              file: 'foo.go',
              line: 20,
              lineEnd: 20,
              content: 'existing comment text',
              author: 'user',
              status: 'open',
              createdAt: '2026-01-01T00:00:00Z',
            },
          ]
        : []

    render(<FileDiff {...baseProps(file, { viewMode: 'split', getCommentsForLine })} />)

    expect(screen.queryByText('existing comment text')).not.toBeInTheDocument()

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(screen.getByText('existing comment text')).toBeInTheDocument()
    })
  })

  it('22. split view: resolve/reopen callbacks fire for comment threads rendered on an expanded line', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const getCommentsForLine = (_file: string, line: number): Comment[] =>
      line === 20
        ? [
            { id: 'c-open', file: 'foo.go', line: 20, lineEnd: 20, content: 'open comment', author: 'user', status: 'open', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'c-resolved', file: 'foo.go', line: 20, lineEnd: 20, content: 'resolved comment', author: 'user', status: 'resolved', createdAt: '2026-01-02T00:00:00Z' },
          ]
        : []
    const onResolveComment = vi.fn(async () => undefined)
    const onReopenComment = vi.fn(async () => undefined)

    render(<FileDiff {...baseProps(file, { viewMode: 'split', getCommentsForLine, onResolveComment, onReopenComment })} />)

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(screen.getByText('open comment')).toBeInTheDocument()
    })

    const openCard = getCommentCard('c-open')
    fireEvent.click(within(openCard).getByTitle('Resolve thread'))
    expect(onResolveComment).toHaveBeenCalledWith('c-open')

    const resolvedCard = getCommentCard('c-resolved')
    fireEvent.click(within(resolvedCard).getByTitle('Reopen thread'))
    expect(onReopenComment).toHaveBeenCalledWith('c-resolved')
  })

  it('23. split view: renders the inline comment-composition form anchored to an expanded line, and not before expansion', async () => {
    const file = buildMainFile()
    stubFetch(buildMainFullFile())
    const onSubmitComment = vi.fn()
    const onCancelComment = vi.fn()

    render(<FileDiff {...baseProps(file, {
      viewMode: 'split',
      activeComment: { line: 20, lineEnd: 20 },
      onSubmitComment,
      onCancelComment,
    })} />)

    expect(screen.queryByPlaceholderText('Leave a comment...')).not.toBeInTheDocument()

    const banner = scopeFromHiddenLabel('34 lines hidden')
    fireEvent.click(within(banner).getByRole('button', { name: '↓ Expand down' }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Leave a comment...')).toBeInTheDocument()
    })
    expect(screen.getByText('Line 20')).toBeInTheDocument()
  })
})
