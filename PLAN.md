# Plan: Suggest button for line comments

## Goal

Add a "suggest" button next to the existing × close button on line comments,
visible only for comments anchored to add/context (right-side) lines — not
pure deletions. Clicking it appends a standard markdown fenced code block
(` ```suggestion ` … ` ``` `) to the comment draft, pre-filled with an exact
copy of the commented line(s) content (supporting multi-line ranges), which
the user then edits in place. Clicking it repeatedly appends additional
independent suggestion blocks.

At comment-creation time, the original (unedited) line(s) content is
captured and persisted alongside the comment as a new `OriginalContent`
field — this becomes the anchor every suggestion block in that comment
diffs against, so rendering never depends on re-resolving live diff/revision
state at display or export time.

Comment display gains structured rendering support: each ` ```suggestion `
block is detected and rendered as a GitHub-style diff (word/char-level
highlighting via `diff`, presented via `react-diff-view`), matching GitHub's
"Suggested change" box as a starting visual target (may be refined later).

When comments are copied out of vibediff (existing export/clipboard
feature), the same blocks are converted to unified diff syntax (---/+++)
instead of the raw fence.

No "apply suggestion" action is in scope — this is display and export only;
nothing in this plan mutates the actual file/diff.

## Scope boundaries

- Suggest button only appears on comments anchored to add/context lines
  (lines present in the resulting file), never on pure-deletion lines.
- Multiple suggestion blocks within a single comment are supported as a
  corner case only (each independently diffs against the same stored
  `OriginalContent`) — not expected to need robust handling beyond that.
- No code-mutating "apply"/"commit suggestion" action.
- No general markdown rendering — only ` ```suggestion ` fences are parsed
  and specially rendered; everything else in a comment body stays plain
  text as today.

## Rules this plan upholds

- Backend `Comment.Content` remains a fully opaque string — no parsing,
  validation, or markdown awareness added server-side
  (`internal/handlers/handlers.go:148`, `internal/review/store.go:154-163`).
- Existing `Line`/`LineEnd` range model is reused unchanged for anchoring;
  no new selection mechanism (`web/src/hooks/useRangeSelection.ts`,
  `fullLineMap` in `web/src/components/FileDiff.tsx:180-192`).
- Suggest is restricted to lines that exist in the resulting file
  (add/context), mirroring GitHub's own constraint.
- No code-mutating "apply" action — display/copy feature only.
- Draft-text append behavior reuses the existing controlled-component
  pattern (`setContent`/`setDraft`, `prev => prev + text`) rather than
  introducing a new state mechanism.

## Rules this plan knowingly bends

- Backend `Comment` schema gains one new additive field
  (`OriginalContent`), a deliberate deviation from "content is a single
  opaque string" to avoid stale/lookup problems at render/export time.
  Additive JSON field — no migration risk; comments predating this feature
  simply lack the field and won't render a suggestion diff, which is
  correct.
- Comment display moves from pure plain-text
  (`whitespace-pre-wrap`, no parsing at all —
  `web/src/components/CommentDisplay.tsx:154-156`) to structured rendering
  that recognizes fenced code blocks — scoped narrowly to ` ```suggestion `
  fences, not a general markdown engine.
- Two new frontend dependencies (`diff`, `react-diff-view`) enter a
  previously dependency-minimal app (7 runtime deps today in
  `web/package.json`) — the first diff-computation/rendering libraries in
  the frontend.

## Key existing code to build on (do not rebuild)

- `web/src/hooks/useRangeSelection.ts` — multi-line drag-range selection.
- `web/src/components/FileDiff.tsx:180-192` (`fullLineMap`) — line number →
  content lookup for the selected range.
- `web/src/types/diff.ts:56-67` and `internal/review/store.go:16-28` —
  `Comment` type/struct, already supports `line`/`lineEnd` ranges.
- `web/src/components/InlineCommentForm.tsx` (`content`/`setContent`) and
  `web/src/components/CommentDisplay.tsx` (`draft`/`setDraft`) — controlled
  textarea append pattern.
- `web/src/hooks/useComments.ts:171-235` (`formatCommentsForExport`) —
  single centralized choke point for all copy/export UI triggers
  (command palette, header button, `SettingsPanel` callback).

## Behavioral examples (ground truth for tests)

**Prefill format.** For a multi-line selection with lines `foo`, `bar`,
`baz`, clicking "suggest" appends exactly:
```
\n```suggestion\nfoo\nbar\nbaz\n```
```
i.e. lines joined by `\n`, no trailing blank line before the closing fence.

**`OriginalContent` storage.** For the same selection, the stored
`OriginalContent` field is `"foo\nbar\nbaz"` — same join, no fence wrapper.
Captured once at comment creation; never re-derived later.

**Word/char-level diff pairing algorithm.** Given N original lines and M
suggested lines: pair original line `i` with suggested line `i` for
`i < min(N, M)` and word-diff only those paired lines. Lines beyond
`min(N, M)` on either side render as plain whole-line add/remove with no
intra-line highlighting.

Example (from the plan's reference screenshot): original = 1 line
(`"Restore the Go module and build caches. Restore-only: the keys and
paths are"`), suggestion = 4 lines (`Restore`, `shneep`, `shnorp`, `the
keys and paths are`).
- Pair `(original[0], new[0])`: word-diff `"Restore the Go module and
  build caches. Restore-only: the keys and paths are"` vs `"Restore"` →
  common prefix `"Restore"` stays unhighlighted; the remainder of the
  original line is highlighted as removed. `"Restore"` on the new side is
  fully common, so it renders with no highlight.
- Lines `shneep`, `shnorp`, `the keys and paths are` (indices 1–3, beyond
  `min(1,4)=1`) render as plain green additions with no intra-line
  highlighting — even though `"the keys and paths are"` textually
  overlaps the original line, it is not paired, so it is not highlighted.

**Unified diff export format.** The per-file `### {file}` header already
printed by `formatCommentsForExport` (`useComments.ts:186`) covers file
identification, so each suggestion block's exported hunk omits `---`/`+++`
file headers and emits only an `@@` hunk anchored to the comment's stored
`line`/`lineEnd`, generated via jsdiff's `structuredPatch` (hunk lines
only, discarding its file-header output). For the example above, anchored
at `line = 3`, `lineEnd = 3`:
```diff
@@ -3,1 +3,4 @@
-Restore the Go module and build caches. Restore-only: the keys and paths are
+Restore
+shneep
+shnorp
+the keys and paths are
```

**Multiple suggestion blocks in one comment.** Comment body:
```
Try this:
```suggestion
foo
```
Or maybe:
```suggestion
bar
```
```
with `OriginalContent = "baz"`. Rendering: two independent diff boxes in
sequence, each diffing its own block against the same `"baz"`, with the
plain text (`Try this:` / `Or maybe:`) rendered normally between them.
Export: two independent `@@` hunks, each diffed against `"baz"`, inserted
in place of their respective fences.

## Flow chart

```
                 +-----------------------------+
                 |   FileDiff / DiffLine (UI)   |
                 |  - line/range selection      |
                 |  - existing drag-range logic |
                 +---------------+-------------+
                                 | original line(s) content
                                 v
        +----------------------------------------------+
        |  InlineCommentForm / CommentDisplay (edit)    |
        |  - NEW "suggest" button next to x             |
        |    (add/context lines only)                   |
        |  - appends ```suggestion fence to draft text  |
        |  - captures originalContent for the comment   |
        +---------------+--------------------------------+
                         | POST/PATCH comment
                         v
        +----------------------------------------------+
        |  Backend: internal/review/store.go            |
        |  Comment{ ..., Content, OriginalContent (NEW)}|
        |  - stored opaque, no parsing/validation        |
        +---------------+--------------------------------+
                         | GET comments
                         v
        +----------------------------------------------+
        |  CommentDisplay.tsx (render)                   |
        |  - NEW: parse ```suggestion fence(s)           |
        |  - diff(originalContent, block-text) via diff  |
        |  - render via react-diff-view                  |
        |    ("Suggested change" box, word-level hl)     |
        +----------------------------------------------+

        +----------------------------------------------+
        |  useComments.ts: formatCommentsForExport       |
        |  - NEW: parse ```suggestion fence(s)           |
        |  - diff(originalContent, block-text) via diff  |
        |  - emit unified diff text (---/+++) in place   |
        |    of the raw fence                            |
        +----------------------------------------------+
```
