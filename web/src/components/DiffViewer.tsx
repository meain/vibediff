import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { DiffType, ViewMode, FileDiff as FileDiffType } from '../types/diff'
import { useDiff } from '../hooks/useDiff'
import { useComments } from '../hooks/useComments'
import { useAllComments } from '../hooks/useAllComments'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useWebSocketUpdates } from '../contexts/WebSocketContext'
import { useDirectory } from '../hooks/useDirectory'
import { useReviewedFiles } from '../hooks/useReviewedFiles'
import { useReviewedRevisions } from '../hooks/useReviewedRevisions'
import { useRevisions } from '../hooks/useRevisions'
import { getButtonClassName, getIconButtonClassName } from '../utils/buttonStyles'
import {
  ListBulletIcon,
  CheckCircleIcon,
  ClockIcon,
  ClipboardDocumentIcon,
  TrashIcon,
  ChevronDoubleUpIcon,
  ChevronDoubleDownIcon,
} from '@heroicons/react/24/outline'
import { Group, Panel, Separator } from 'react-resizable-panels'
import FileList from './FileList'
import FileDiff from './FileDiff'
import FullFileModal from './FullFileModal'
import HelpModal from './HelpModal'
import SettingsPanel from './SettingsPanel'
import DirectorySwitcher from './DirectorySwitcher'
import RevisionList from './RevisionList'
import CommitSummary from './CommitSummary'
import Toast from './Toast'

interface DiffViewerProps {
  className?: string
}

export default function DiffViewer({ className = '' }: DiffViewerProps): React.ReactElement {
  const [diffType, setDiffType] = useState<DiffType>(() => (localStorage.getItem('diffType') as DiffType | null) ?? 'all')
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('viewMode') as ViewMode | null) ?? 'unified')
  const [selectedFile, setSelectedFile] = useState<FileDiffType | null>(null)
  const [displayMode, setDisplayMode] = useState<'single' | 'all'>(() => (localStorage.getItem('displayMode') as 'single' | 'all' | null) ?? 'single')
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const [commentDialog, setCommentDialog] = useState<{ file: string; line: number; lineEnd: number } | null>(null)
  const [fullFileModal, setFullFileModal] = useState<string | null>(null)
  const [fileViewMode, setFileViewMode] = useState<'list' | 'tree'>(() => (localStorage.getItem('sidebarView') as 'list' | 'tree' | null) ?? 'list')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [wrapLines, setWrapLines] = useState<boolean>(() => { const v = localStorage.getItem('wrapLines'); return v !== null ? v === 'true' : true })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [selectedRevision, setSelectedRevision] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('rev')
  })
  // Tracks the file path from the URL on first load so we can restore it once data arrives
  const initialFilePathRef = useRef<string | null>(new URLSearchParams(window.location.search).get('file'))
  // Directory from URL (used once on mount to override registry default)
  const initialDirFromUrlRef = useRef<string | null>(new URLSearchParams(window.location.search).get('dir'))

  const { currentDirectory, backend, directories, homeDir, setCurrentDirectory, registerDirectory, removeDirectory, reorderDirectories, validateDirectory } = useDirectory()
  const { data, loading, error, refetch } = useDiff(currentDirectory, diffType, selectedRevision)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [copyAllFeedback, setCopyAllFeedback] = useState(false)
  const [showComments, setShowComments] = useState(true)
  const { lastUpdate, lastUpdateDir } = useWebSocketUpdates()
  const { comments, addComment, updateComment, deleteComment, resolveComment, reopenComment, getCommentsForLine, getCommentRangeLines, formatCommentsForExport, formatPendingCommentsForExport, clearComments, fetchError, clearFetchError } = useComments(currentDirectory, selectedRevision)
  const { reviewedFiles, toggleReviewed, clearReviewed, validateReviewed } = useReviewedFiles(currentDirectory, selectedRevision)
  const totalThreads = comments.filter(c => !c.parentId).length
  const pendingThreads = comments.filter(c => !c.parentId && c.status === 'open').length
  const commentCountsByAuthor = useMemo(() => {
    let user = 0
    const agents = new Map<string, number>()
    for (const c of comments) {
      if (c.author !== 'agent') {
        user += 1
        continue
      }
      const label = c.authorName ?? 'Agent'
      agents.set(label, (agents.get(label) ?? 0) + 1)
    }
    return { user, agents }
  }, [comments])
  const allFilesCollapsed = collapsedFiles.size === data?.files.length
  let collapseAllTitle = 'Collapse all'
  if (displayMode === 'single') collapseAllTitle = 'Available in All Files mode'
  else if (allFilesCollapsed) collapseAllTitle = 'Expand all'
  const { reviewedRevisions, markRevisionReviewed, unmarkRevisionReviewed } = useReviewedRevisions(currentDirectory)
  const { revisions, loading: revisionsLoading, refetch: refetchRevisions } = useRevisions(currentDirectory)
  const commentCountsByRevision = useAllComments(currentDirectory)

  // Top-level (non-reply) comment counts per file, for the file browser badges.
  const commentCountsByFile = useMemo(() => {
    const counts = new Map<string, number>()
    if (!showComments) return counts
    for (const comment of comments) {
      if (comment.parentId) continue
      counts.set(comment.file, (counts.get(comment.file) ?? 0) + 1)
    }
    return counts
  }, [comments, showComments])

  const getCommentsForLineGated = useCallback(
    (file: string, line: number) => showComments ? getCommentsForLine(file, line) : [],
    [showComments, getCommentsForLine]
  )
  const getCommentRangeLinesGated = useCallback(
    (file: string, lineOrder: number[]) => showComments ? getCommentRangeLines(file, lineOrder) : new Set<number>(),
    [showComments, getCommentRangeLines]
  )

  // Refetch when WebSocket triggers an update, but only if it's for the current directory
  // (or if the update has no directory, which means broadcast-all).
  useEffect(() => {
    if (lastUpdateDir && currentDirectory && lastUpdateDir !== currentDirectory) return
    setIsRefreshing(true)
    refetch()
    refetchRevisions()
    const timer = setTimeout(() => { setIsRefreshing(false); }, 500)
    return () => { clearTimeout(timer); }
  }, [lastUpdate, lastUpdateDir, currentDirectory, refetch, refetchRevisions])

  // When revisions reload, check if the selected revision still exists.
  // If a commit was squashed/abandoned the change_id disappears from the
  // list, so reset to the working-copy view instead of staying stuck on
  // a stale (and now-failing) revision diff.
  useEffect(() => {
    if (selectedRevision !== null && !revisionsLoading && revisions.length > 0) {
      const stillExists = revisions.some(r => r.id === selectedRevision)
      if (!stillExists) {
        setSelectedRevision(null)
        setSelectedFile(null)
      }
    }
  }, [revisions, revisionsLoading, selectedRevision])

  // Load preferences from localStorage
  useEffect(() => {
    const savedCollapsed = localStorage.getItem('collapsedFiles')
    if (savedCollapsed) {
      try {
        setCollapsedFiles(new Set(JSON.parse(savedCollapsed) as string[]))
      } catch (e) {
        console.error('Failed to parse collapsed files', e)
      }
    }

    const savedCollapsedFolders = localStorage.getItem('collapsedFolders')
    if (savedCollapsedFolders) {
      try {
        setCollapsedFolders(new Set(JSON.parse(savedCollapsedFolders) as string[]))
      } catch (e) {
        console.error('Failed to parse collapsed folders', e)
      }
    }

  }, []) // viewMode, displayMode, diffType, wrapLines are initialized lazily from localStorage above

  // Restore directory from URL on first load (once directories are available)
  useEffect(() => {
    const urlDir = initialDirFromUrlRef.current
    if (urlDir && directories.includes(urlDir) && currentDirectory !== urlDir) {
      setCurrentDirectory(urlDir)
      initialDirFromUrlRef.current = null
    }
  }, [directories, currentDirectory, setCurrentDirectory])

  // Sync directory, revision, and file to URL params
  useEffect(() => {
    const params = new URLSearchParams()
    if (currentDirectory) params.set('dir', currentDirectory)
    if (selectedRevision) params.set('rev', selectedRevision)
    if (selectedFile) params.set('file', selectedFile.path)
    const search = params.toString()
    const newUrl = search ? `${window.location.pathname}?${search}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [currentDirectory, selectedRevision, selectedFile])

  // Save preferences using the custom hook
  useLocalStorage('viewMode', viewMode)
  useLocalStorage('diffType', diffType)
  useLocalStorage('displayMode', displayMode)
  useLocalStorage('collapsedFiles', collapsedFiles)
  useLocalStorage('sidebarView', fileViewMode)
  useLocalStorage('collapsedFolders', collapsedFolders)
  useLocalStorage('wrapLines', wrapLines)

  // Auto-mark/unmark the current revision as fully reviewed whenever the
  // reviewed-files set or diff data changes.
  useEffect(() => {
    if (!data || data.files.length === 0) return
    const revKey = selectedRevision ?? 'working-copy'
    if (reviewedFiles.size >= data.files.length) {
      markRevisionReviewed(revKey)
    } else {
      unmarkRevisionReviewed(revKey)
    }
  }, [reviewedFiles, data, selectedRevision, markRevisionReviewed, unmarkRevisionReviewed])

  // Auto-select first file when data loads and validate reviewed files
  useEffect(() => {
    if (data?.files.length) {
      validateReviewed(data.files)

      // Auto-collapse generated files (they can still be expanded manually).
      const generatedPaths = data.files.filter(f => f.isGenerated).map(f => f.path)
      if (generatedPaths.length > 0) {
        setCollapsedFiles(prev => {
          const next = new Set(prev)
          generatedPaths.forEach(p => next.add(p))
          return next
        })
      }

      if (!selectedFile) {
        const pending = initialFilePathRef.current
        if (pending) {
          initialFilePathRef.current = null
          const fromUrl = data.files.find(f => f.path === pending)
          setSelectedFile(fromUrl ?? data.files[0])
        } else {
          setSelectedFile(data.files[0])
        }
      } else {
        const stillExists = data.files.find(f => f.path === selectedFile.path)
        if (stillExists) {
          setSelectedFile(stillExists)
        } else {
          setSelectedFile(data.files[0])
        }
      }
    }
  }, [data, selectedFile, validateReviewed])

  const handleToggleReviewed = (file: FileDiffType): void => {
    const wasReviewed = reviewedFiles.has(file.path)
    toggleReviewed(file)
    if (!wasReviewed) {
      setCollapsedFiles(prev => new Set([...prev, file.path]))
    } else {
      setCollapsedFiles(prev => {
        const newSet = new Set(prev)
        newSet.delete(file.path)
        return newSet
      })
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!data?.files.length || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      const currentIndex = selectedFile ? data.files.findIndex(f => f.path === selectedFile.path) : -1

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const nextIndex = currentIndex + 1
        if (nextIndex < data.files.length) {
          setSelectedFile(data.files[nextIndex])
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const prevIndex = currentIndex - 1
        if (prevIndex >= 0) {
          setSelectedFile(data.files[prevIndex])
        }
      } else if (e.key === 'r' && selectedFile && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        handleToggleReviewed(selectedFile)
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        setShowHelp(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); }
  }, [data, selectedFile, handleToggleReviewed])

  const toggleFileCollapse = (filePath: string): void => {
    setCollapsedFiles(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filePath)) {
        newSet.delete(filePath)
      } else {
        newSet.add(filePath)
      }
      return newSet
    })
  }

  const toggleAllCollapse = (): void => {
    if (collapsedFiles.size === data?.files.length) {
      setCollapsedFiles(new Set())
    } else {
      setCollapsedFiles(new Set(data?.files.map(f => f.path) ?? []))
    }
  }

  const handleClearComments = (): void => {
    if (comments.length === 0) return
    // eslint-disable-next-line no-alert
    if (window.confirm('Clear all comments? This cannot be undone.')) {
      void clearComments()
    }
  }

  const handleClearReviewed = (): void => {
    if (reviewedFiles.size === 0) return
    // eslint-disable-next-line no-alert
    if (window.confirm('Clear all reviewed marks?')) {
      clearReviewed()
    }
  }

  const handleCancelComment = useCallback(() => { setCommentDialog(null); }, [])

  const handleSingleFileToggleCollapse = useCallback(() => { /* Single file view doesn't collapse */ }, [])

  const handleSingleFileAddComment = useCallback((line: number, lineEnd: number) => {
    if (selectedFile) setCommentDialog({ file: selectedFile.path, line, lineEnd })
  }, [selectedFile])

  const handleSingleFileViewFullFile = useCallback(() => {
    if (selectedFile) setFullFileModal(selectedFile.path)
  }, [selectedFile])

  const handleSingleFileToggleReviewed = useCallback(() => {
    if (selectedFile) handleToggleReviewed(selectedFile)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, reviewedFiles])

  const handleSingleFileAddReply = useCallback(async (parent: import('../types/diff').Comment, content: string) => {
    await addComment(parent.file, parent.line, content, parent.lineEnd, parent.id)
  }, [addComment])

  const handleSingleFileSubmitComment = useCallback((content: string) => {
    if (commentDialog) {
      void addComment(commentDialog.file, commentDialog.line, content, commentDialog.lineEnd).then(() => {
        setCommentDialog(null)
      }).catch((err: unknown) => {
        console.error('Failed to add comment:', err)
      })
    }
  }, [commentDialog, addComment])


  const selectedRevisionData = selectedRevision
    ? revisions.find(r => r.id === selectedRevision) ?? null
    : backend === 'jj'
      ? revisions.find(r => r.isWorkingCopy) ?? null
      : null

  const diffTotals = data
    ? data.files.reduce(
        (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
        { additions: 0, deletions: 0 }
      )
    : { additions: 0, deletions: 0 }

  const handleDirectoryChange = async (dir: string): Promise<void> => {
    if (!directories.includes(dir)) {
      // Not yet registered — validate + add to registry, which also sets currentDirectory.
      await registerDirectory(dir)
    } else {
      setCurrentDirectory(dir)
    }
    setSelectedRevision(null)
    setSelectedFile(null)
    // useDiff and useRevisions will re-fetch automatically when currentDirectory changes.
  }

  // Only show the full-screen loading spinner on the very first load (no
  // data yet). Subsequent refetches keep the existing layout visible so
  // the sidebar and revision list stay usable while content updates.
  if (loading && !data) {
    return (
      <div className={`flex justify-center items-center h-screen ${className}`}>
        <div className="text-fg-subtle">Loading diff...</div>
      </div>
    )
  }

  return (
    <>
      <div className={`flex flex-col h-screen bg-surface ${viewMode === 'split' ? 'split-view-active' : ''}`}>
      {/* Header */}
      <header className="bg-surface-raised border-b border-edge">
        <div className="px-4 py-1.5">
          <div className="flex items-center justify-between flex-nowrap">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-fg">VibeDiff</h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-surface-inset text-fg-muted border border-edge uppercase tracking-wide">
                {backend}
              </span>
              {isRefreshing && (
                <span className="text-sm text-fg-subtle animate-pulse">Updating...</span>
              )}
            </div>
            <div className="flex items-end gap-2 flex-nowrap whitespace-nowrap">
            {/* Diff Type Selector - only for git working copy (jj has no staging area) */}
            {selectedRevision === null && backend === 'git' && (
              <>
                <div className="flex">
                  {(['all', 'staged', 'unstaged'] as DiffType[]).map((type, index) => (
                    <button
                      key={type}
                      onClick={() => { setDiffType(type); }}
                      className={`${(() => {
                        const isActive = diffType === type
                        if (index === 0) return getButtonClassName(isActive, 'left')
                        if (index === 2) return getButtonClassName(isActive, 'right')
                        return getButtonClassName(isActive, 'middle')
                      })()} inline-flex items-center gap-1.5`}
                    >
                      {type === 'all' && <ListBulletIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />}
                      {type === 'staged' && <CheckCircleIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />}
                      {type === 'unstaged' && <ClockIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />}
                      {type === 'all' ? 'All Changes' : type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="border-l border-edge h-5" />
              </>
            )}

            {/* Comment Actions (copy pending / clear) */}
            {(pendingThreads > 0 || comments.length > 0) && (
              <fieldset className="flex m-0 p-0 border border-edge/60 rounded-md">
                <legend className="px-1 ml-1.5 text-[10px] text-fg-subtle leading-none">Comments</legend>
                {pendingThreads > 0 && (
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(formatPendingCommentsForExport(revisions)).then(() => {
                        setCopyFeedback(true)
                        setTimeout(() => { setCopyFeedback(false); }, 1500)
                      })
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-fg-muted hover:bg-surface-inset hover:text-fg transition-colors cursor-pointer ${comments.length > 0 ? 'rounded-l-md border-r border-edge/60' : 'rounded-md'}`}
                    title="Copy pending review comments as markdown"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                    {copyFeedback ? 'Copied!' : 'Copy'}
                  </button>
                )}

                {comments.length > 0 && (
                  <button
                    onClick={handleClearComments}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-fg-muted hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer ${pendingThreads > 0 ? 'rounded-r-md' : 'rounded-md'}`}
                    title="Clear comments"
                  >
                    <TrashIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                    Clear
                  </button>
                )}
              </fieldset>
            )}

            {/* Collapse All Button */}
            <button
              onClick={toggleAllCollapse}
              className={`${getIconButtonClassName(false)} disabled:opacity-50 disabled:cursor-not-allowed`}
              disabled={displayMode === 'single'}
              title={collapseAllTitle}
            >
              {allFilesCollapsed ? (
                <ChevronDoubleDownIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              ) : (
                <ChevronDoubleUpIcon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              )}
            </button>

            {/* Wrap Lines Toggle */}
            <button
              onClick={() => { setWrapLines(!wrapLines); }}
              className={getIconButtonClassName(wrapLines)}
              title="Toggle line wrapping"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h10.5m3-2.25 2.25 2.25-2.25 2.25" />
              </svg>
            </button>

            <SettingsPanel
              showComments={showComments}
              onToggleComments={() => { setShowComments(v => !v); }}
              onCopyAllComments={() => {
                void navigator.clipboard.writeText(formatCommentsForExport(revisions)).then(() => {
                  setCopyAllFeedback(true)
                  setTimeout(() => { setCopyAllFeedback(false); }, 1500)
                })
              }}
              copyAllFeedback={copyAllFeedback}
              hasComments={comments.length > 0}
              totalThreads={totalThreads}
              pendingThreads={pendingThreads}
              commentCountsByAuthor={commentCountsByAuthor}
              viewMode={viewMode}
              onToggleViewMode={() => { setViewMode(viewMode === 'unified' ? 'split' : 'unified'); }}
              displayMode={displayMode}
              onToggleDisplayMode={() => { setDisplayMode(displayMode === 'single' ? 'all' : 'single'); }}
            />
            </div>
          </div>
        </div>
      </header>

      <Group orientation="horizontal" className="min-h-[calc(100vh-53px)]" id="resize-group">
        {/* Sidebar */}
        <Panel defaultSize={20} minSize={15} maxSize={600} id="sidebar">
          <Group orientation="vertical" className="h-full" id="sidebar-group">
            <Panel defaultSize={60} minSize={20} id="file-panel">
              <div className="h-full bg-surface-raised border-r border-edge flex flex-col">
                <DirectorySwitcher
                  currentDirectory={currentDirectory}
                  directories={directories}
                  homeDir={homeDir}
                  onSelectDirectory={(dir) => {
                    setCurrentDirectory(dir)
                    setSelectedRevision(null)
                    setSelectedFile(null)
                  }}
                  onAddDirectory={handleDirectoryChange}
                  onRemoveDirectory={removeDirectory}
                  onReorderDirectories={reorderDirectories}
                  onValidate={validateDirectory}
                />

                {/* File List */}
                <div className="flex-1 min-h-0">
                  <FileList
                    files={data?.files ?? []}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                    displayMode={displayMode}
                    viewMode={fileViewMode}
                    onToggleViewMode={() => { setFileViewMode(fileViewMode === 'list' ? 'tree' : 'list'); }}
                    collapsedFolders={collapsedFolders}
                    onToggleFolderCollapse={(folder) => {
                      setCollapsedFolders(prev => {
                        const newSet = new Set(prev)
                        if (newSet.has(folder)) {
                          newSet.delete(folder)
                        } else {
                          newSet.add(folder)
                        }
                        return newSet
                      })
                    }}
                    reviewedFiles={reviewedFiles}
                    onToggleReviewed={handleToggleReviewed}
                    commentCounts={commentCountsByFile}
                  />
                </div>

                {/* Clear Reviews Button */}
                <button
                  onClick={handleClearReviewed}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-fg-muted border-t border-edge hover:bg-danger/10 hover:text-danger transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                  disabled={reviewedFiles.size === 0}
                  title={reviewedFiles.size === 0 ? 'No reviewed files to clear' : 'Clear reviewed marks'}
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  Clear Reviews
                </button>
              </div>
            </Panel>

            <Separator
              className="h-1.5 bg-edge hover:bg-accent transition-colors"
              data-separator="resize-handle"
            />

            <Panel defaultSize={40} minSize={15} id="revision-panel">
              <div className="h-full bg-surface-raised border-r border-edge flex flex-col">
                <RevisionList
                  revisions={revisions}
                  loading={revisionsLoading}
                  selectedRevision={selectedRevision}
                  onSelectRevision={(rev) => {
                    setSelectedRevision(rev)
                    setSelectedFile(null)
                  }}
                  backend={backend}
                  reviewedRevisions={reviewedRevisions}
                  commentCounts={commentCountsByRevision}
                />
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator
          className="w-1.5 bg-edge hover:bg-accent transition-colors"
          data-separator="resize-handle"
        />

        {/* Main Content */}
        <Panel defaultSize={80} minSize={40} id="main">
          <div className="h-full bg-surface overflow-y-auto">
        {selectedRevisionData && data && data.files.length > 0 && (
          <CommitSummary
            revision={selectedRevisionData}
            filesChanged={data.files.length}
            additions={diffTotals.additions}
            deletions={diffTotals.deletions}
          />
        )}
        {(() => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (loading) {
            return (
              <div className="flex items-center justify-center h-full">
                <p className="text-fg-subtle">Loading...</p>
              </div>
            )
          }
          if (error) {
            return (
              <div className="flex items-center justify-center h-full">
                <p className="text-red-500">Error loading diff: {error}</p>
              </div>
            )
          }
          if (!data || data.files.length === 0) {
            return (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-fg-subtle">No changes to display</p>
              </div>
            )
          }
          if (displayMode === 'all') {
            return (
          <div>
            {data.files.map((file) => (
              <FileDiff
                key={file.path}
                file={file}
                viewMode={viewMode}
                collapsed={collapsedFiles.has(file.path)}
                onToggleCollapse={() => { toggleFileCollapse(file.path); }}
                onAddComment={(line, lineEnd) => { setCommentDialog({ file: file.path, line, lineEnd }); }}
                onViewFullFile={() => { setFullFileModal(file.path); }}
                getCommentsForLine={getCommentsForLineGated}
                getCommentRangeLines={getCommentRangeLinesGated}
                onDeleteComment={deleteComment}
                onUpdateComment={updateComment}
                onAddReply={async (parent, content) => { await addComment(parent.file, parent.line, content, parent.lineEnd, parent.id) }}
                onResolveComment={resolveComment}
                onReopenComment={reopenComment}
                wrapLines={wrapLines}
                diffType={diffType}
                selectedRevision={selectedRevision}
                directory={currentDirectory}
                isReviewed={reviewedFiles.has(file.path)}
                onToggleReviewed={() => { handleToggleReviewed(file); }}
                commentCount={showComments ? comments.filter(c => c.file === file.path && !c.parentId).length : 0}
                pendingCommentCount={showComments ? comments.filter(c => c.file === file.path && !c.parentId && c.status === 'open').length : 0}
                activeComment={commentDialog?.file === file.path ? { line: commentDialog.line, lineEnd: commentDialog.lineEnd } : null}
                onSubmitComment={(content) => {
                  if (commentDialog) {
                    void addComment(commentDialog.file, commentDialog.line, content, commentDialog.lineEnd).then(() => {
                      setCommentDialog(null)
                    }).catch((err: unknown) => {
                      console.error('Failed to add comment:', err)
                    })
                  }
                }}
                onCancelComment={handleCancelComment}
              />
            ))}
          </div>
            )
          }
          if (selectedFile !== null) {
            return (
          <div>
            <FileDiff
              file={selectedFile}
              viewMode={viewMode}
              collapsed={false}
              onToggleCollapse={handleSingleFileToggleCollapse}
              onAddComment={handleSingleFileAddComment}
              onViewFullFile={handleSingleFileViewFullFile}
              getCommentsForLine={getCommentsForLineGated}
              getCommentRangeLines={getCommentRangeLinesGated}
              onDeleteComment={deleteComment}
              onUpdateComment={updateComment}
              onAddReply={handleSingleFileAddReply}
              wrapLines={wrapLines}
              diffType={diffType}
              selectedRevision={selectedRevision}
              directory={currentDirectory}
              isReviewed={reviewedFiles.has(selectedFile.path)}
              onToggleReviewed={handleSingleFileToggleReviewed}
              commentCount={showComments ? comments.filter(c => c.file === selectedFile.path && !c.parentId).length : 0}
              pendingCommentCount={showComments ? comments.filter(c => c.file === selectedFile.path && !c.parentId && c.status === 'open').length : 0}
              activeComment={commentDialog?.file === selectedFile.path ? { line: commentDialog.line, lineEnd: commentDialog.lineEnd } : null}
              onSubmitComment={handleSingleFileSubmitComment}
              onCancelComment={handleCancelComment}
            />
          </div>
            )
          }
          return (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-fg-subtle">Select a file to view changes</p>
            </div>
          )
        })()}
          </div>
        </Panel>
      </Group>

      {/* Full File Modal */}
      <FullFileModal
        isOpen={!!fullFileModal}
        filePath={fullFileModal ?? ''}
        directory={currentDirectory}
        onClose={() => { setFullFileModal(null); }}
        viewMode={viewMode}
        getCommentsForLine={getCommentsForLineGated}
        getCommentRangeLines={getCommentRangeLinesGated}
        onDeleteComment={deleteComment}
        onUpdateComment={updateComment}
        onAddReply={async (parent, content) => { await addComment(parent.file, parent.line, content, parent.lineEnd, parent.id) }}
        onResolveComment={resolveComment}
        onReopenComment={reopenComment}
        onAddComment={(file, line, content, lineEnd) => {
          void addComment(file, line, content, lineEnd).catch((err: unknown) => {
            console.error('Failed to add comment:', err)
          })
        }}
        wrapLines={wrapLines}
        diffType={diffType}
        selectedRevision={selectedRevision}
      />

      {/* Help Modal */}
      <HelpModal
        isOpen={showHelp}
        onClose={() => { setShowHelp(false); }}
      />
      </div>

      {/* Error Toast */}
      {fetchError !== null && (
        <Toast message={fetchError} onDismiss={clearFetchError} type="error" />
      )}
    </>
  )
}
