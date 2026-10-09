import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import OutsideDiffComments from './OutsideDiffComments'
import type { Comment } from '../types/diff'

const base = { content: 'note', author: 'user', status: 'open', createdAt: '2026-01-01T00:00:00Z' } as const

describe('OutsideDiffComments', () => {
  it('renders nothing without comments', () => {
    const { container } = render(<OutsideDiffComments comments={[]} onDelete={vi.fn(async () => undefined)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('groups comments by file and line with labels', () => {
    const comments: Comment[] = [
      { ...base, id: 'a', file: 'x.go', line: 7, lineEnd: 7, content: 'first' },
      { ...base, id: 'b', file: 'x.go', line: 0, lineEnd: 0, content: 'whole file' },
      { ...base, id: 'c', file: 'y.go', line: 3, lineEnd: 5, content: 'range' },
    ]
    render(<OutsideDiffComments comments={comments} onDelete={vi.fn(async () => undefined)} />)
    expect(screen.getByText('x.go')).toBeInTheDocument()
    expect(screen.getByText('y.go')).toBeInTheDocument()
    expect(screen.getByText('Line 7')).toBeInTheDocument()
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.getByText('Lines 3–5')).toBeInTheDocument()
    expect(screen.getByText('whole file')).toBeInTheDocument()
  })
})
