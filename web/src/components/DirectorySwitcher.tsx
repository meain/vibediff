import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { FolderIcon, ChevronDownIcon } from '@heroicons/react/24/solid'

interface DirectorySwitcherProps {
  currentDirectory: string
  directories: string[]
  homeDir?: string
  onSelectDirectory: (dir: string) => void
  onAddDirectory: (dir: string) => Promise<void>
  onRemoveDirectory: (dir: string) => Promise<void>
  onReorderDirectories: (dirs: string[]) => Promise<void>
  onValidate: (dir: string) => Promise<{ valid: boolean; error?: string }>
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
}: DirectorySwitcherProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [orderedDirs, setOrderedDirs] = useState<string[]>(directories)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const validationTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [isOpen])

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

  const formatPath = useCallback((path: string, maxLength = 40) => {
    let formatted = path
    if (homeDir && formatted.startsWith(homeDir)) {
      formatted = '~' + formatted.slice(homeDir.length)
    }
    if (formatted.length <= maxLength) return formatted
    return '...' + formatted.slice(-(maxLength - 3))
  }, [homeDir])

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
    void onReorderDirectories(newDirs)
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
        <span className="font-medium truncate flex-1 text-left">{formatPath(currentDirectory || 'No directory', 40)}</span>
        <ChevronDownIcon className="w-2.5 h-2.5 ml-0.5 shrink-0" />
      </button>

      {isOpen && menuPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed w-[500px] bg-surface-raised border border-edge rounded-lg shadow-xl z-50 max-h-[400px] overflow-auto">
          {/* Add new directory */}
          <div className="p-3 border-b border-edge">
            <div className="text-xs font-semibold text-fg-muted mb-2">Add Directory</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                placeholder="Enter directory path..."
                className="flex-1 px-3 py-1.5 border border-edge rounded text-sm bg-surface text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={() => void handleAdd()}
                disabled={!inputValue || !!validationError || isValidating || isAdding}
                className="px-3 py-1.5 bg-accent text-accent-fg border border-accent rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-emphasis transition-colors"
              >
                {isAdding ? 'Adding...' : 'Add'}
              </button>
            </div>
            {isValidating && (
              <div className="mt-2 text-xs text-fg-muted">Validating...</div>
            )}
            {validationError && (
              <div className="mt-2 text-xs text-danger">{validationError}</div>
            )}
          </div>

          {/* Registered directories */}
          {orderedDirs.length > 0 ? (
            <div className="p-2">
              <div className="text-xs font-semibold text-fg-muted mb-2 px-2">Registered Directories</div>
              {orderedDirs.map((dir, index) => (
                <div
                  key={dir}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center justify-between px-2 py-1.5 rounded group transition-colors cursor-grab active:cursor-grabbing ${
                    dragOverIndex === index && dragIndex !== index ? 'border-t-2 border-accent' : ''
                  } ${dir === currentDirectory ? 'bg-accent-muted' : 'hover:bg-surface-inset'} ${
                    dragIndex === index ? 'opacity-40' : ''
                  }`}
                >
                  <svg className="w-3 h-3 text-fg-subtle mr-1.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" fill="currentColor" viewBox="0 0 16 16">
                    <circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/>
                    <circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/>
                    <circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/>
                  </svg>
                  <button
                    onClick={() => { onSelectDirectory(dir); setIsOpen(false) }}
                    className={`flex-1 text-left text-sm truncate ${dir === currentDirectory ? 'text-accent-emphasis font-medium' : 'text-fg'}`}
                    title={dir}
                  >
                    {formatPath(dir)}
                  </button>
                  {dir !== currentDirectory && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void onRemoveDirectory(dir)
                      }}
                      className="ml-2 px-1.5 py-0.5 text-danger hover:bg-danger/10 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from registry"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-sm text-fg-muted text-center">
              No registered directories
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
