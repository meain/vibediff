import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlassIcon, ChevronLeftIcon } from '@heroicons/react/24/outline'

export interface CommandItem {
  id: string
  section: string
  label: string
  hint?: string
  icon?: React.ReactNode
  /** Either `action` (runs and closes the palette) or `children` (drills into a submenu of these items) must be set. */
  action?: () => void
  children?: CommandItem[]
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  items: CommandItem[]
}

/** Walks `stack` (a path of parent item ids) down from the root `items`, returning the items and labels at each level. */
function resolveStack(items: CommandItem[], stack: string[]): { items: CommandItem[]; labels: string[] } {
  let level = items
  const labels: string[] = []
  for (const id of stack) {
    const parent = level.find((i) => i.id === id)
    if (!parent) break
    labels.push(parent.label)
    level = parent.children ?? []
  }
  return { items: level, labels }
}

export default function CommandPalette({ isOpen, onClose, items }: CommandPaletteProps): React.ReactElement | null {
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [stack, setStack] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const { items: currentItems, labels: breadcrumbs } = useMemo(
    () => resolveStack(items, stack),
    [items, stack]
  )

  const filteredItems = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return currentItems
    return currentItems.filter((item) => {
      const haystack = `${item.section} ${item.label}`.toLowerCase()
      return tokens.every((t) => haystack.includes(t))
    })
  }, [currentItems, query])

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setHighlightedIndex(0)
      setStack([])
      requestAnimationFrame(() => { inputRef.current?.focus() })
    }
  }, [isOpen])

  useEffect(() => {
    setHighlightedIndex(0)
  }, [query, stack])

  useEffect(() => {
    itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  const goBack = useCallback(() => {
    setStack((prev) => prev.slice(0, -1))
    setQuery('')
  }, [])

  const runItem = useCallback((item: CommandItem) => {
    if (item.children) {
      setStack((prev) => [...prev, item.id])
      setQuery('')
      requestAnimationFrame(() => { inputRef.current?.focus() })
      return
    }
    onClose()
    item.action?.()
  }, [onClose])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (stack.length > 0) goBack()
      else onClose()
    } else if (e.key === 'Backspace' && query === '' && stack.length > 0) {
      e.preventDefault()
      goBack()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, filteredItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < filteredItems.length) {
        runItem(filteredItems[highlightedIndex])
      }
    }
  }

  if (!isOpen) return null

  const sections: { name: string; items: CommandItem[] }[] = []
  for (const item of filteredItems) {
    let section = sections.find((s) => s.name === item.section)
    if (!section) {
      section = { name: item.section, items: [] }
      sections.push(section)
    }
    section.items.push(item)
  }

  let flatIndex = -1

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-surface-overlay backdrop-blur-sm pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-edge rounded-lg shadow-2xl w-full max-w-lg max-h-[60vh] flex flex-col overflow-hidden mx-4"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-edge shrink-0">
          {stack.length > 0 ? (
            <button
              onClick={goBack}
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg shrink-0 cursor-pointer"
              title="Back"
            >
              <ChevronLeftIcon className="w-4 h-4 shrink-0" />
              {breadcrumbs[breadcrumbs.length - 1]}
            </button>
          ) : (
            <MagnifyingGlassIcon className="w-4 h-4 text-fg-subtle shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder={stack.length > 0 ? `Search ${breadcrumbs[breadcrumbs.length - 1]}…` : 'Type a command or search…'}
            className="flex-1 min-w-0 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 bg-surface-inset border border-edge rounded text-[10px] font-mono text-fg-subtle shrink-0">Esc</kbd>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
          {sections.length === 0 && (
            <div className="px-3 py-6 text-sm text-fg-subtle text-center">No matching commands</div>
          )}
          {sections.map((section) => (
            <div key={section.name} className="mb-1 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                {section.name}
              </div>
              {section.items.map((item) => {
                flatIndex += 1
                const idx = flatIndex
                const isHighlighted = idx === highlightedIndex
                return (
                  <button
                    key={item.id}
                    ref={(el) => { itemRefs.current[idx] = el }}
                    onClick={() => { runItem(item); }}
                    onMouseEnter={() => { setHighlightedIndex(idx); }}
                    className={`flex items-center justify-between w-full px-2 py-1.5 rounded text-sm text-left transition-colors cursor-pointer ${
                      isHighlighted ? 'bg-accent-muted text-accent-emphasis' : 'text-fg hover:bg-surface-inset'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {item.icon && (
                        <span className="w-3.5 h-3.5 shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{item.icon}</span>
                      )}
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.hint && (
                      <span className="text-xs text-fg-subtle shrink-0 ml-2">{item.hint}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
