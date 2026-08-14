import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InlineCommentForm from './InlineCommentForm'

// InlineCommentForm renders a single <tr>, so it must be mounted inside a
// <table>/<tbody> to produce valid DOM (matching how FileDiff.tsx uses it).
function renderForm(overrides: Record<string, unknown> = {}): ReturnType<typeof render> {
  const props = {
    line: 3,
    lineEnd: 3,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    colSpan: 3,
    ...overrides,
  }
  return render(
    <table>
      <tbody>
        <InlineCommentForm {...props} />
      </tbody>
    </table>
  )
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText<HTMLTextAreaElement>('Leave a comment...')
}

describe('InlineCommentForm suggest button', () => {
  it('renders the Suggest button when originalLines is a non-empty array', () => {
    renderForm({ originalLines: ['const x = 1'] })

    expect(screen.getByRole('button', { name: 'Suggest' })).toBeInTheDocument()
  })

  it('does not render the Suggest button when originalLines is null', () => {
    renderForm({ originalLines: null })

    expect(screen.queryByRole('button', { name: 'Suggest' })).not.toBeInTheDocument()
  })

  it('does not render the Suggest button when originalLines is undefined', () => {
    renderForm({ originalLines: undefined })

    expect(screen.queryByRole('button', { name: 'Suggest' })).not.toBeInTheDocument()
  })

  it('appends the expected fenced suggestion text to the draft when clicked', () => {
    renderForm({ originalLines: ['foo', 'bar'] })

    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))

    expect(getTextarea().value).toBe('\n```suggestion\nfoo\nbar\n```')
  })

  it('appends two independent blocks when clicked twice, growing rather than replacing the draft', () => {
    renderForm({ originalLines: ['foo'] })

    const suggestButton = screen.getByRole('button', { name: 'Suggest' })
    fireEvent.click(suggestButton)
    fireEvent.click(suggestButton)

    expect(getTextarea().value).toBe(
      '\n```suggestion\nfoo\n```' + '\n```suggestion\nfoo\n```'
    )
  })

  it('submits both the typed content and the joined originalContent after using suggest', () => {
    const onSubmit = vi.fn()
    renderForm({ originalLines: ['foo', 'bar'], onSubmit })

    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      '```suggestion\nfoo\nbar\n```',
      'foo\nbar'
    )
  })
})
