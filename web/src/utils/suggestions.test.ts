import { describe, it, expect } from 'vitest'
import {
  buildSuggestionAppendText,
  parseCommentSegments,
  pairLinesForDiff,
  formatSuggestionExportHunk,
} from './suggestions'

describe('buildSuggestionAppendText', () => {
  it('joins multi-line selection into a suggestion fence with no trailing blank line', () => {
    const result = buildSuggestionAppendText(['foo', 'bar', 'baz'])

    expect(result).toBe('\n```suggestion\nfoo\nbar\nbaz\n```')
  })
})

describe('parseCommentSegments', () => {
  it('parses multiple suggestion blocks interleaved with text', () => {
    const content =
      'Try this:\n```suggestion\nfoo\n```\nOr maybe:\n```suggestion\nbar\n```'

    const segments = parseCommentSegments(content)

    expect(segments).toHaveLength(4)

    expect(segments[0].type).toBe('text')
    expect(segments[0].value.trim()).toBe('Try this:')

    expect(segments[1]).toEqual({ type: 'suggestion', value: 'foo' })

    expect(segments[2].type).toBe('text')
    expect(segments[2].value.trim()).toBe('Or maybe:')

    expect(segments[3]).toEqual({ type: 'suggestion', value: 'bar' })
  })

  it('parses a comment body that is only a suggestion fence with no surrounding text', () => {
    const content = '```suggestion\nfoo\nbar\n```'

    const segments = parseCommentSegments(content)

    expect(segments).toEqual([{ type: 'suggestion', value: 'foo\nbar' }])
  })

  it('parses a comment body with no suggestion fence as a single text segment', () => {
    const content = 'Just a plain comment with no suggestion.'

    const segments = parseCommentSegments(content)

    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('text')
  })
})

describe('pairLinesForDiff', () => {
  it('pairs lines up to min(N, M) with word-diff tokens, leaving the rest unpaired', () => {
    const original = [
      'Restore the Go module and build caches. Restore-only: the keys and paths are',
    ]
    const suggested = ['Restore', 'shneep', 'shnorp', 'the keys and paths are']

    const result = pairLinesForDiff(original, suggested)

    expect(result).toHaveLength(4)

    // Entry 0: paired
    const first = result[0]
    expect(first.original).toBe(original[0])
    expect(first.suggested).toBe('Restore')
    expect(first.originalTokens).toBeDefined()
    expect(first.suggestedTokens).toBeDefined()

    const originalTokens = first.originalTokens ?? []
    expect(
      originalTokens.some(
        (t) => t.type === 'unchanged' && original[0].startsWith(t.text)
      )
    ).toBe(true)
    expect(originalTokens.some((t) => t.type === 'removed')).toBe(true)

    const suggestedTokens = first.suggestedTokens ?? []
    expect(suggestedTokens.every((t) => t.type === 'unchanged')).toBe(true)
    expect(suggestedTokens.map((t) => t.text).join('')).toBe('Restore')

    // Entries 1-3: beyond min(1,4)=1, unpaired plain additions
    for (let i = 1; i <= 3; i++) {
      expect(result[i].originalTokens).toBeUndefined()
      expect(result[i].suggestedTokens).toBeUndefined()
      expect(result[i].original).toBeUndefined()
    }
    expect(result[1].suggested).toBe('shneep')
    expect(result[2].suggested).toBe('shnorp')
    expect(result[3].suggested).toBe('the keys and paths are')
  })

  it('leaves original lines beyond the pairing boundary unpaired when there are more original lines than suggested', () => {
    const original = ['line one', 'line two', 'line three']
    const suggested = ['line one']

    const result = pairLinesForDiff(original, suggested)

    expect(result).toHaveLength(3)

    // Entry 0: paired (min(3,1) = 1)
    expect(result[0].original).toBe('line one')
    expect(result[0].suggested).toBe('line one')

    // Entries 1-2: beyond min(3,1)=1, unpaired plain removals
    for (let i = 1; i <= 2; i++) {
      expect(result[i].originalTokens).toBeUndefined()
      expect(result[i].suggestedTokens).toBeUndefined()
      expect(result[i].suggested).toBeUndefined()
    }
    expect(result[1].original).toBe('line two')
    expect(result[2].original).toBe('line three')
  })
})

describe('parseCommentSegments edge cases', () => {
  it('returns an empty array for an empty string', () => {
    expect(parseCommentSegments('')).toEqual([])
  })

  it('treats an unclosed suggestion fence as plain text (no closing ``` found)', () => {
    const content = 'Try this:\n```suggestion\nfoo\nbar'

    const segments = parseCommentSegments(content)

    expect(segments).toEqual([{ type: 'text', value: content }])
  })

  it('preserves whitespace-only text segments surrounding a fence', () => {
    const content = '   \n```suggestion\nfoo\n```\n   '

    const segments = parseCommentSegments(content)

    expect(segments).toEqual([
      { type: 'text', value: '   ' },
      { type: 'suggestion', value: 'foo' },
      { type: 'text', value: '   ' },
    ])
  })

  it('parses back-to-back suggestion blocks with no separator text between them', () => {
    const content = '```suggestion\nfoo\n```\n```suggestion\nbar\n```'

    const segments = parseCommentSegments(content)

    expect(segments).toEqual([
      { type: 'suggestion', value: 'foo' },
      { type: 'suggestion', value: 'bar' },
    ])
  })
})

describe('pairLinesForDiff edge cases', () => {
  it('returns an empty array when both inputs are empty', () => {
    expect(pairLinesForDiff([], [])).toEqual([])
  })

  it('produces only unchanged tokens when original and suggested lines are identical', () => {
    const lines = ['line one', 'line two']

    const result = pairLinesForDiff(lines, lines)

    expect(result).toHaveLength(2)
    for (const pair of result) {
      expect(pair.originalTokens).toBeDefined()
      expect(pair.suggestedTokens).toBeDefined()
      const originalTokens = pair.originalTokens ?? []
      const suggestedTokens = pair.suggestedTokens ?? []
      expect(originalTokens.length).toBeGreaterThan(0)
      expect(suggestedTokens.length).toBeGreaterThan(0)
      expect(originalTokens.every((t) => t.type === 'unchanged')).toBe(true)
      expect(suggestedTokens.every((t) => t.type === 'unchanged')).toBe(true)
      expect(originalTokens.some((t) => t.type === 'removed')).toBe(false)
      expect(suggestedTokens.some((t) => t.type === 'added')).toBe(false)
    }
  })

  it('pairs a single line with no word overlap as a full removal/addition, not unchanged', () => {
    const result = pairLinesForDiff(['abc def'], ['xyz uvw'])

    expect(result).toHaveLength(1)
    const [pair] = result
    expect(pair.original).toBe('abc def')
    expect(pair.suggested).toBe('xyz uvw')
    expect(pair.originalTokens).toBeDefined()
    expect(pair.suggestedTokens).toBeDefined()
    const originalTokens = pair.originalTokens ?? []
    const suggestedTokens = pair.suggestedTokens ?? []
    expect(originalTokens.length).toBeGreaterThan(0)
    expect(suggestedTokens.length).toBeGreaterThan(0)
    expect(originalTokens.every((t) => t.type === 'removed')).toBe(true)
    expect(suggestedTokens.every((t) => t.type === 'added')).toBe(true)
  })
})

describe('formatSuggestionExportHunk', () => {
  it('formats a single-line original expanded into a multi-line suggestion', () => {
    const originalContent =
      'Restore the Go module and build caches. Restore-only: the keys and paths are'
    const suggestionText = 'Restore\nshneep\nshnorp\nthe keys and paths are'

    const result = formatSuggestionExportHunk(
      originalContent,
      suggestionText,
      3,
      3
    )

    const expected = [
      '@@ -3,1 +3,4 @@',
      '-Restore the Go module and build caches. Restore-only: the keys and paths are',
      '+Restore',
      '+shneep',
      '+shnorp',
      '+the keys and paths are',
    ].join('\n')

    expect(result).toBe(expected)
  })

  it('formats a multi-line original collapsed into a single-line suggestion', () => {
    const originalContent = 'foo\nbar\nbaz'
    const suggestionText = 'qux'

    const result = formatSuggestionExportHunk(originalContent, suggestionText, 3, 5)

    const expected = ['@@ -3,3 +3,1 @@', '-foo', '-bar', '-baz', '+qux'].join(
      '\n'
    )

    expect(result).toBe(expected)
  })

  it('formats a single-line original replaced by a single-line suggestion (N=M=1)', () => {
    const result = formatSuggestionExportHunk('foo bar', 'foo baz', 7, 7)

    const expected = ['@@ -7,1 +7,1 @@', '-foo bar', '+foo baz'].join('\n')

    expect(result).toBe(expected)
  })

  it('strips the "\\ No newline at end of file" marker when inputs have no trailing newline', () => {
    const result = formatSuggestionExportHunk('foo bar', 'foo baz', 7, 7)

    expect(result).not.toContain('No newline at end of file')
  })
})
