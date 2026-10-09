import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CommentDisplay from './CommentDisplay'
import type { Comment } from '../types/diff'

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    file: 'foo.go',
    line: 3,
    lineEnd: 3,
    content: 'plain comment',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function renderComments(comments: Comment[]): ReturnType<typeof render> {
  return render(
    <CommentDisplay comments={comments} onDelete={vi.fn()} />
  )
}

describe('CommentDisplay suggestion rendering', () => {
  it('renders a plain comment with no suggestion fence as plain text', () => {
    const comment = makeComment({ content: 'Just a plain comment with no suggestion.' })

    renderComments([comment])

    expect(screen.getByText('Just a plain comment with no suggestion.')).toBeInTheDocument()
  })

  it('renders both a removed-line and an added-line representation when originalContent is present', () => {
    const comment = makeComment({
      content: '```suggestion\nconst x = 2\n```',
      originalContent: 'const x = 1',
    })

    const { container } = renderComments([comment])

    expect(container.textContent).toContain('const x = 1')
    expect(container.textContent).toContain('const x = 2')
    // Removed/added row markers rendered by SuggestionDiffBox.
    expect(screen.getAllByText('−').length).toBeGreaterThan(0)
    expect(screen.getAllByText('+').length).toBeGreaterThan(0)
  })

  it('renders a fallback add-only box without crashing when originalContent is missing (pre-existing comment)', () => {
    const comment = makeComment({
      content: '```suggestion\nconst x = 2\n```',
      originalContent: undefined,
    })

    let container!: HTMLElement
    expect(() => { ({ container } = renderComments([comment])); }).not.toThrow()

    expect(container.textContent).toContain('const x = 2')
    // No removed-line marker should be present since there's nothing to diff against.
    expect(screen.queryByText('−')).not.toBeInTheDocument()
    expect(screen.getAllByText('+').length).toBeGreaterThan(0)
  })
})

describe('CommentDisplay reply folding', () => {
  const reply = makeComment({ id: 'r1', parentId: 'c1', content: 'a reply' })

  it('shows replies on open threads by default', () => {
    renderComments([makeComment({ status: 'open' }), reply])
    expect(screen.getByText('a reply')).toBeInTheDocument()
  })

  it('folds replies on resolved threads until expanded', () => {
    renderComments([makeComment({ status: 'resolved' }), reply])
    expect(screen.queryByText('a reply')).toBeNull()
    fireEvent.click(screen.getByTitle('Show replies'))
    expect(screen.getByText('a reply')).toBeInTheDocument()
  })
})

describe('CommentDisplay fold on resolve', () => {
  it('re-folds a manually expanded thread when it is resolved', () => {
    const reply = makeComment({ id: 'r1', parentId: 'c1', content: 'a reply' })
    const onResolve = vi.fn()
    const { rerender } = render(
      <CommentDisplay comments={[makeComment({ status: 'open' }), reply]} onDelete={vi.fn()} onResolve={onResolve} />
    )
    // Fold then re-expand so the thread carries a manual toggle.
    fireEvent.click(screen.getByTitle('Hide replies'))
    fireEvent.click(screen.getByTitle('Show replies'))
    expect(screen.getByText('a reply')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Resolve thread'))
    expect(onResolve).toHaveBeenCalledWith('c1')
    rerender(
      <CommentDisplay comments={[makeComment({ status: 'resolved' }), reply]} onDelete={vi.fn()} onResolve={onResolve} />
    )
    expect(screen.queryByText('a reply')).toBeNull()
  })
})

describe('CommentDisplay unfold on reopen', () => {
  it('expands replies when a resolved thread is reopened', () => {
    const reply = makeComment({ id: 'r1', parentId: 'c1', content: 'a reply' })
    const onReopen = vi.fn()
    const { rerender } = render(
      <CommentDisplay comments={[makeComment({ status: 'resolved' }), reply]} onDelete={vi.fn()} onReopen={onReopen} />
    )
    expect(screen.queryByText('a reply')).toBeNull()

    fireEvent.click(screen.getByTitle('Reopen thread'))
    expect(onReopen).toHaveBeenCalledWith('c1')
    rerender(
      <CommentDisplay comments={[makeComment({ status: 'open' }), reply]} onDelete={vi.fn()} onReopen={onReopen} />
    )
    expect(screen.getByText('a reply')).toBeInTheDocument()
  })
})
