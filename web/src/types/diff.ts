export type DiffType = 'all' | 'staged' | 'unstaged'
export type ViewMode = 'unified' | 'split'

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FileDiff {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
  isBinary?: boolean
  isGenerated?: boolean
  hunks: Hunk[]
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

export interface DiffLine {
  type: 'normal' | 'add' | 'delete' | 'context' | 'added' | 'deleted'
  oldLineNumber?: number
  newLineNumber?: number
  oldNumber?: number
  newNumber?: number
  content: string
}

export interface DiffResult {
  files: FileDiff[]
  type: DiffType
  revision?: string
}

export type VCSBackend = 'git' | 'jj'

export interface Revision {
  id: string
  shortId: string
  description: string
  author: string
  timestamp: string
  isWorkingCopy?: boolean
  bookmarks?: string[]
  parents?: string[]
  additions?: number
  deletions?: number
}

export type CommentAuthor = 'user' | 'agent'
export type CommentStatus = 'open' | 'resolved'

export interface Comment {
  id: string
  file: string
  line: number
  lineEnd: number
  side?: string
  content: string
  author: CommentAuthor
  parentId?: string
  status: CommentStatus
  revision?: string
  commit?: string
  createdAt: string
}

export interface DirectoryInfo {
  directory: string
}

export interface DirectoryValidation {
  valid: boolean
  error?: string
}
