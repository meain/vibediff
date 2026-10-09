import { createContext, useContext } from 'react'
import type { CommentReaction } from '../types/diff'

// Provides the thumbs up/down handler to comment cards without threading it
// through every diff component's props. Absent provider => no reaction buttons.
export const CommentReactionContext = createContext<((id: string, reaction: CommentReaction) => Promise<void>) | undefined>(undefined)

export function useCommentReaction(): ((id: string, reaction: CommentReaction) => Promise<void>) | undefined {
  return useContext(CommentReactionContext)
}
