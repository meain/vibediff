import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { FolderIcon, ChevronDownIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import type { DirectoryEntry } from '../hooks/useDirectory'

interface DirectorySwitcherProps {
  currentDirectory: string
  directories: DirectoryEntry[]
  homeDir?: string
  onSelectDirectory: (dir: string) => void
  onAddDirectory: (dir: string) => Promise<void>
  onRemoveDirectory: (dir: string) => Promise<void>
  onReorderDirectories: (dirs: string[]) => Promise<void>
  onValidate: (dir: string) => Promise<{ valid: boolean; error?: string }>
  onSetAlias: (path: string, alias: string) => Promise<void>
}

export default function DirectorySwitcher({
  currentDirectory,
  directories,
  homeDir = '',
  onSelectDirectory,
  onAddDirectory,
  onRemoveDirectory,
  onReorderDirectories,
  onValidate,
  onSetAlias,
}: DirectorySwitcherProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [orderedDirs, setOrderedDirs] = useState<DirectoryEntry[]>(directories)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null)
  const [gearMenuPos, setGearMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const validationTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const editInputRef = useRef<HTMLInputElement>(null)
  const openMenuRef = useRef<HTMLDivElement>(null)
  const gearButtonRef = useRef<HTMLButtonElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const filterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setIsOpen(false)
        cancelEditingAlias()
      }
      const insideMenu = openMenuRef.current?.contains(target)
      const insideGearButton = gearButtonRef.current?.contains(target)
      if (!insideMenu && !insideGearButton) {
        setOpenMenuPath(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left })
      setInputValue('')
      setHighlightedIndex(0)
    }
  }, [isOpen])

  // Reset the highlighted row whenever the filter text changes.
  useEffect(() => {
    setHighlightedIndex(0)
  }, [inputValue])

  // Focus the filter input once the dropdown has actually mounted.
  useEffect(() => {
    if (isOpen && menuPos) {
      filterInputRef.current?.focus()
    }
  }, [isOpen, menuPos])

  useEffect(() => {
    rowRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // Close the gear menu on scroll of the (scrollable) directory list, rather
  // than trying to keep a fixed-position portal glued to a moving row.
  useEffect(() => {
    if (!openMenuPath || !dropdownRef.current) return
    const list = dropdownRef.current
    const handleScroll = (): void => { setOpenMenuPath(null) }
    list.addEventListener('scroll', handleScroll)
    return () => { list.removeEventListener('scroll', handleScroll) }
  }, [openMenuPath])

  useEffect(() => {
    if (inputValue) {
      setIsValidating(true)
      setValidationError(null)

      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }

      validationTimeoutRef.current = setTimeout(async () => {
        const result = await onValidate(inputValue)
        setIsValidating(false)
        if (!result.valid) {
          setValidationError(result.error ?? 'Invalid directory')
        }
      }, 300)
    } else {
      setValidationError(null)
      setIsValidating(false)
    }

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [inputValue, onValidate])

  const handleAdd = async () => {
    if (!inputValue || validationError || isValidating) return
    setIsAdding(true)
    try {
      await onAddDirectory(inputValue)
      setInputValue('')
      setIsOpen(false)
    } catch {
      // error is handled upstream (useDirectory sets error state)
    } finally {
      setIsAdding(false)
    }
  }

  // Keep local ordered list in sync when the prop changes (add/remove)
  useEffect(() => {
    setOrderedDirs(directories)
  }, [directories])

  const isFiltering = inputValue.trim().length > 0
  const filteredDirs = useMemo(() => {
    const query = inputValue.trim().toLowerCase()
    if (!query) return orderedDirs
    return orderedDirs.filter(d =>
      d.path.toLowerCase().includes(query) || d.alias?.toLowerCase().includes(query)
    )
  }, [orderedDirs, inputValue])

  // Keep the highlighted row in range if the list shrinks (directory removed, filter narrows).
  useEffect(() => {
    setHighlightedIndex(i => Math.min(i, Math.max(filteredDirs.length - 1, 0)))
  }, [filteredDirs.length])

  // Alias-aware: prefers entry.alias over entry.path, then applies the same
  // homeDir substitution + truncation as before.
  const formatPath = useCallback((entry: DirectoryEntry, maxLength = 40) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string alias means "unset", so fall back to path
    let formatted = entry.alias || entry.path
    if (homeDir && formatted.startsWith(homeDir)) {
      formatted = '~' + formatted.slice(homeDir.length)
    }
    if (formatted.length <= maxLength) return formatted
    return '...' + formatted.slice(-(maxLength - 3))
  }, [homeDir])

  // Autofocus + select-all when a row enters alias-edit mode
  useEffect(() => {
    if (editingPath !== null && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingPath])

  const startEditingAlias = (entry: DirectoryEntry): void => {
    setEditingPath(entry.path)
    setEditValue(entry.alias ?? '')
    setOpenMenuPath(null)
  }

  const cancelEditingAlias = (): void => {
    setEditingPath(null)
    setEditValue('')
  }

  const commitEditingAlias = (): void => {
    const trimmed = editValue.trim()
    const path = editingPath
    setEditingPath(null)
    setEditValue('')
    if (path && trimmed) {
      void onSetAlias(path, trimmed)
    }
  }

  const handleCopyPath = (path: string): void => {
    void navigator.clipboard.writeText(path).then(() => {
      setCopiedPath(path)
      setTimeout(() => { setCopiedPath(p => (p === path ? null : p)) }, 1200)
    })
  }

  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const newDirs = [...orderedDirs]
    const [moved] = newDirs.splice(dragIndex, 1)
    newDirs.splice(index, 0, moved)
    setOrderedDirs(newDirs)
    setDragIndex(null)
    setDragOverIndex(null)
    // Reorder API is unchanged — it still takes a bare path array.
    void onReorderDirectories(newDirs.map(d => d.path))
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-fg-muted hover:bg-surface-inset hover:text-fg border-b border-edge transition-colors"
        title={currentDirectory}
      >
        <FolderIcon className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="font-medium truncate flex-1 text-left">
          {currentDirectory
            ? formatPath(directories.find(d => d.path === currentDirectory) ?? { path: currentDirectory, alias: '' }, 40)
            : 'No directory'}
        </span>
        <ChevronDownIcon className="w-2.5 h-2.5 ml-0.5 shrink-0" />
      </button>

      {isOpen && menuPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed w-[500px] bg-surface-raised border border-edge rounded-lg shadow-xl z-50 flex flex-col max-h-[400px]">
          {/* Filter existing directories / add a new one */}
          <div className="shrink-0 flex gap-2 p-2 border-b border-edge">
            <input
              type="text"
              ref={filterInputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  if (filteredDirs.length > 0) setHighlightedIndex(i => Math.min(i + 1, filteredDirs.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (filteredDirs.length > 0) setHighlightedIndex(i => Math.max(i - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (filteredDirs.length > 0) {
                    onSelectDirectory(filteredDirs[highlightedIndex].path)
                    setIsOpen(false)
                  } else {
                    void handleAdd()
                  }
                }
              }}
              placeholder="Filter or add a directory…"
              className="flex-1 px-2 py-1.5 text-xs bg-surface-inset text-fg placeholder:text-fg-subtle border-b border-edge focus:outline-none focus:border-accent"
            />
            {inputValue && (
              <button
                onClick={() => void handleAdd()}
                disabled={!!validationError || isValidating || isAdding}
                className="px-3 py-1.5 bg-accent text-accent-fg border border-accent rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-emphasis transition-colors"
              >
                {isAdding ? 'Adding...' : 'Add'}
              </button>
            )}
          </div>
          {validationError && (
            <div className="shrink-0 px-2 pt-2 text-xs text-danger">{validationError}</div>
          )}

          {/* Registered directories */}
          {filteredDirs.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-auto p-2">
              {filteredDirs.map((dir, index) => {
                let rowBgClass = 'hover:bg-surface-inset'
                if (dir.path === currentDirectory) rowBgClass = 'bg-accent-muted'
                else if (index === highlightedIndex) rowBgClass = 'bg-surface-inset'
                return (
                <div
                  key={dir.path}
                  ref={(el) => { rowRefs.current[index] = el }}
                  draggable={editingPath !== dir.path && !isFiltering}
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`relative flex items-center justify-between px-2 py-1.5 rounded group transition-colors cursor-grab active:cursor-grabbing ${
                    dragOverIndex === index && dragIndex !== index ? 'border-t-2 border-accent' : ''
                  } ${rowBgClass} ${
                    dragIndex === index ? 'opacity-40' : ''
                  }`}
                >
                  {editingPath === dir.path ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editValue}
                      onChange={(e) => { setEditValue(e.target.value) }}
                      onClick={(e) => { e.stopPropagation() }}
                      onMouseDown={(e) => { e.stopPropagation() }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEditingAlias()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEditingAlias()
                        }
                      }}
                      onBlur={() => {
                        if (editingPath === dir.path) cancelEditingAlias()
                      }}
                      className="flex-1 min-w-0 px-1.5 py-0.5 border border-accent rounded text-sm bg-surface text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  ) : (
                    <>
                      <svg className="w-3 h-3 text-fg-subtle mr-1.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" fill="currentColor" viewBox="0 0 16 16">
                        <circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/>
                        <circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/>
                        <circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/>
                      </svg>
                      <button
                        onClick={() => { onSelectDirectory(dir.path); setIsOpen(false) }}
                        className={`flex-1 text-left text-sm truncate ${dir.path === currentDirectory ? 'text-accent-emphasis font-medium' : 'text-fg'}`}
                        title={dir.path}
                      >
                        {formatPath(dir)}
                      </button>
                      <div className="shrink-0">
                        <button
                          ref={openMenuPath === dir.path ? gearButtonRef : undefined}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (openMenuPath === dir.path) {
                              setOpenMenuPath(null)
                              return
                            }
                            const rect = e.currentTarget.getBoundingClientRect()
                            setGearMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                            setOpenMenuPath(dir.path)
                          }}
                          onMouseDown={(e) => { e.stopPropagation() }}
                          className="p-1 rounded text-fg-muted hover:text-fg hover:bg-surface-inset opacity-0 group-hover:opacity-100 transition-opacity data-[open=true]:opacity-100"
                          data-open={openMenuPath === dir.path}
                          title="Directory options"
                        >
                          <Cog6ToothIcon className="w-3.5 h-3.5 shrink-0" />
                        </button>

                        {openMenuPath === dir.path && gearMenuPos && createPortal(
                          <div
                            ref={openMenuRef}
                            onClick={(e) => { e.stopPropagation() }}
                            onMouseDown={(e) => { e.stopPropagation() }}
                            style={{ top: gearMenuPos.top, right: gearMenuPos.right }}
                            className="fixed w-40 bg-surface-raised border border-edge rounded-md shadow-xl z-[60] py-1 text-fg"
                          >
                            <button
                              className="flex items-center w-full px-3 py-1.5 text-xs text-left rounded transition-colors hover:bg-surface-inset cursor-pointer"
                              onClick={() => { startEditingAlias(dir) }}
                            >
                              Alias
                            </button>
                            {dir.alias && (
                              <button
                                className="flex items-center w-full px-3 py-1.5 text-xs text-left rounded transition-colors hover:bg-surface-inset cursor-pointer"
                                onClick={() => {
                                  void onSetAlias(dir.path, '')
                                  setOpenMenuPath(null)
                                }}
                              >
                                Clear Alias
                              </button>
                            )}
                            <button
                              className="flex items-center w-full px-3 py-1.5 text-xs text-left rounded transition-colors hover:bg-surface-inset cursor-pointer"
                              onClick={() => { handleCopyPath(dir.path) }}
                            >
                              {copiedPath === dir.path ? 'Copied!' : 'Copy Path'}
                            </button>
                            {dir.path !== currentDirectory && (
                              <button
                                className="flex items-center w-full px-3 py-1.5 text-xs text-left rounded transition-colors hover:bg-danger/10 text-danger cursor-pointer"
                                onClick={() => {
                                  void onRemoveDirectory(dir.path)
                                  setOpenMenuPath(null)
                                }}
                              >
                                Remove
                              </button>
                            )}
                          </div>,
                          document.body
                        )}
                      </div>
                    </>
                  )}
                </div>
                )
              })}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto p-4 text-sm text-fg-muted text-center">
              {isFiltering ? 'No directories match' : 'No registered directories'}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
