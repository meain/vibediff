// Contract module for the "suggest" feature on line comments. See
// /Users/ryan.keepers/go/src/github.com/meain/vibediff/PLAN.md for the full
// spec, scope boundaries, and behavioral examples these signatures must
// satisfy. This module declares the public contract only — implementations
// land in a later phase.

import { diffWords, structuredPatch } from 'diff'

export interface DiffToken {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

export interface PairedLine {
  original?: string
  suggested?: string
  // Present only when this line is paired (index < min(originalLines.length, suggestedLines.length))
  // and needs intra-line highlighting. Absent for lines beyond that pairing boundary.
  originalTokens?: DiffToken[]
  suggestedTokens?: DiffToken[]
}

export interface CommentSegment {
  type: 'text' | 'suggestion'
  value: string
}

// Returns the exact text to append to a comment draft for a suggest-button click,
// given the selected original line(s). See PLAN.md "Prefill format" behavioral example.
export function buildSuggestionAppendText(lines: string[]): string {
  return `\n\`\`\`suggestion\n${lines.join('\n')}\n\`\`\``
}

// Matches a ```suggestion fenced block, consuming one adjacent newline on either side
// (if present) since those newlines are structural separators introduced by
// buildSuggestionAppendText / markdown fence conventions rather than part of the
// surrounding plain text.
const SUGGESTION_FENCE_RE = /\n?```suggestion\n([\s\S]*?)\n```\n?/g

// Splits a comment body into alternating plain-text and suggestion-fence segments,
// in order. For 'suggestion' segments, `value` is the fenced block's inner text
// (lines joined by '\n', fence markers stripped). See PLAN.md "Multiple suggestion
// blocks in one comment" example.
export function parseCommentSegments(content: string): CommentSegment[] {
  const fenceRegex = new RegExp(SUGGESTION_FENCE_RE)
  const segments: CommentSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'suggestion', value: match[1] })
    lastIndex = fenceRegex.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }
  return segments
}

// Implements the plan's pairing algorithm: pair originalLines[i] with suggestedLines[i]
// for i < min(N, M), computing word/char-level diff tokens for each paired line via the
// `diff` package. Lines beyond min(N, M) on either side get no tokens (plain whole-line
// add/remove). See PLAN.md "Word/char-level diff pairing algorithm" example.
export function pairLinesForDiff(originalLines: string[], suggestedLines: string[]): PairedLine[] {
  const pairCount = Math.min(originalLines.length, suggestedLines.length)
  const maxCount = Math.max(originalLines.length, suggestedLines.length)
  const result: PairedLine[] = []

  for (let i = 0; i < maxCount; i++) {
    if (i < pairCount) {
      const original = originalLines[i]
      const suggested = suggestedLines[i]
      const changes = diffWords(original, suggested)
      const originalTokens: DiffToken[] = []
      const suggestedTokens: DiffToken[] = []
      for (const change of changes) {
        if (change.added) {
          suggestedTokens.push({ type: 'added', text: change.value })
        } else if (change.removed) {
          originalTokens.push({ type: 'removed', text: change.value })
        } else {
          originalTokens.push({ type: 'unchanged', text: change.value })
          suggestedTokens.push({ type: 'unchanged', text: change.value })
        }
      }
      result.push({ original, suggested, originalTokens, suggestedTokens })
    } else {
      result.push({
        original: i < originalLines.length ? originalLines[i] : undefined,
        suggested: i < suggestedLines.length ? suggestedLines[i] : undefined,
      })
    }
  }

  return result
}

// Produces a unified-diff hunk (no ---/+++ file headers) for one suggestion block,
// anchored at `line`/`lineEnd`. See PLAN.md "Unified diff export format" example for
// the exact expected output string.
export function formatSuggestionExportHunk(
  originalContent: string,
  suggestionText: string,
  line: number,
  lineEnd: number,
): string {
  // A very large context ensures structuredPatch always collapses the whole
  // comparison into a single hunk, regardless of any incidentally-matching lines.
  const patch = structuredPatch('', '', originalContent, suggestionText, undefined, undefined, {
    context: Number.MAX_SAFE_INTEGER,
  })
  const oldLines = lineEnd - line + 1
  const newLines = suggestionText.split('\n').length
  const header = `@@ -${String(line)},${String(oldLines)} +${String(line)},${String(newLines)} @@`
  const bodyLines = patch.hunks.length > 0
    ? patch.hunks[0].lines.filter(l => !l.startsWith('\\'))
    : []

  return [header, ...bodyLines].join('\n')
}
