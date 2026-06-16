import type { Comment } from '../types/diff'

export interface ThreadedComment {
  root: Comment
  replies: Comment[]
}

/**
 * Turn a flat comment list into root+replies pairs.
 * Root comments have no parentId; replies attach to their root by parentId.
 * Orphaned replies (parent not in the list) are rendered as roots.
 */
export function groupIntoThreads(comments: Comment[]): ThreadedComment[] {
  const byId = new Map<string, Comment>()
  for (const c of comments) {
    byId.set(c.id, c)
  }

  const threads = new Map<string, ThreadedComment>()
  const orphans: Comment[] = []

  for (const c of comments) {
    if (!c.parentId) {
      if (!threads.has(c.id)) {
        threads.set(c.id, { root: c, replies: [] })
      } else {
        threads.get(c.id)!.root = c
      }
    } else if (byId.has(c.parentId)) {
      const parentThread = threads.get(c.parentId)
      if (parentThread) {
        parentThread.replies.push(c)
      } else {
        threads.set(c.parentId, { root: byId.get(c.parentId)!, replies: [c] })
      }
    } else {
      orphans.push(c)
    }
  }

  const sortByCreated = (a: Comment, b: Comment): number =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()

  const result = Array.from(threads.values())
  for (const t of result) {
    t.replies.sort(sortByCreated)
  }
  for (const o of orphans) {
    result.push({ root: o, replies: [] })
  }
  result.sort((a, b) => sortByCreated(a.root, b.root))
  return result
}
