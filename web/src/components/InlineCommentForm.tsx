import { useState, useEffect, useRef } from 'react'
import { buildSuggestionAppendText } from '../utils/suggestions'

interface InlineCommentFormProps {
  line: number
  lineEnd: number
  onSubmit: (content: string, originalContent?: string) => void
  onCancel: () => void
  colSpan: number
  // Original line(s) content for the commented range, when eligible for the
  // "suggest" button (add/context lines whose content could be resolved).
  // `null`/`undefined` means ineligible — no button, no OriginalContent capture.
  originalLines?: string[] | null
}

export default function InlineCommentForm({ line, lineEnd, onSubmit, onCancel, colSpan, originalLines }: InlineCommentFormProps): React.ReactElement {
  const [content, setContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = setTimeout(() => { textareaRef.current?.focus(); }, 0)
    return () => { clearTimeout(t); }
  }, [])

  // Auto-grow the textarea to fit its content (e.g. multi-line suggestion
  // blocks appended by the "Suggest" button), capped by the max-h set in
  // the className below where overflow-y-auto takes over.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${String(el.scrollHeight)}px`
  }, [content])

  const handleSubmit = (): void => {
    if (content.trim()) {
      onSubmit(content.trim(), originalLines ? originalLines.join('\n') : undefined)
      setContent('')
    }
  }

  const handleSuggestClick = (): void => {
    if (!originalLines) return
    setContent(prev => prev + buildSuggestionAppendText(originalLines))
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onCancel()
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const rangeLabel = lineEnd !== line
    ? `Lines ${String(Math.abs(line))}-${String(Math.abs(lineEnd))}`
    : `Line ${String(Math.abs(line))}`

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className="mx-3 my-1.5 rounded-lg border border-accent/30 bg-accent-muted/30 overflow-hidden max-w-2xl">
            <div className="px-3 py-1.5 border-b border-accent/20 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">{rangeLabel}</span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-fg-subtle">⌘Enter to submit · Esc to cancel</span>
                {originalLines && (
                  <button
                    type="button"
                    onClick={handleSuggestClick}
                    className="text-fg-subtle hover:text-fg text-[10px] font-medium px-1.5 py-0.5 rounded hover:bg-surface-inset cursor-pointer bg-transparent border border-edge transition-colors"
                    title="Insert a suggested change"
                  >
                    Suggest
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-fg-subtle hover:text-fg text-sm leading-none px-1 cursor-pointer bg-transparent border-none"
                  title="Cancel (Esc)"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="p-2 flex gap-2">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => { setContent(e.target.value); }}
                onKeyDown={handleKeyDown}
                placeholder="Leave a comment..."
                rows={2}
                className="flex-1 px-2 py-1.5 border border-edge rounded-md text-sm
                  bg-surface text-fg placeholder-fg-subtle
                  focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20
                  resize-none max-h-[40vh] overflow-y-auto"
                style={{ fontFamily: 'inherit' }}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!content.trim()}
                className="px-3 py-1.5 text-xs font-medium text-accent-fg shrink-0 self-end
                  bg-accent hover:bg-accent-emphasis disabled:opacity-40
                  rounded-md transition-colors disabled:cursor-not-allowed cursor-pointer"
              >
                Comment
              </button>
            </div>
          </div>
      </td>
    </tr>
  )
}
