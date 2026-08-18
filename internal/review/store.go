package review

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// AuthorUser and AuthorAgent enumerate Comment.Author values. User comments
// originate from the vibediff browser UI; agent comments are written by an
// external client posting to the comment API.
const (
	AuthorUser  = "user"
	AuthorAgent = "agent"
)

// StatusOpen and StatusResolved enumerate Comment.Status values. Resolution
// is user-driven only; the agent has no tool to flip status.
const (
	StatusOpen     = "open"
	StatusResolved = "resolved"
)

// Comment is a review note anchored to a file, line range, and (optionally)
// a specific revision. Revision/Commit pin the point-in-time the user was
// looking at when the comment was created so consumers can render the
// original code even after the working copy drifts.
// Directory scopes the comment to a specific project directory, enabling
// multi-project support without separate server state.
// AuthorName is an optional free-form tag, typically set by agent clients
// to identify which kind of agent posted the comment (e.g. "explainer").
// The UI renders it as "agent:<authorName>" alongside the author badge.
type Comment struct {
	ID        string `json:"id"`
	Directory string `json:"directory,omitempty"`
	File      string `json:"file"`
	Line      int    `json:"line,omitempty"`
	LineEnd   int    `json:"lineEnd,omitempty"`
	Side      string `json:"side,omitempty"`
	Content   string `json:"content"`
	// OriginalContent is the commented line(s) content, captured once at
	// creation; suggestion blocks in Content diff against this.
	OriginalContent string    `json:"originalContent"`
	Author          string    `json:"author"`
	AuthorName      string    `json:"authorName,omitempty"`
	ParentID        string    `json:"parentId,omitempty"`
	Status          string    `json:"status"`
	Revision        string    `json:"revision,omitempty"`
	Commit          string    `json:"commit,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}

// Subscriber receives a callback after a comment is added to the store.
// Subscribers are durable — they fire on every AddComment until the
// caller invokes the unsubscribe function returned by Subscribe.
// Subscribers run in a goroutine so a slow subscriber cannot block
// AddComment, and a panicking subscriber cannot bring down the writer.
type Subscriber func(*Comment)

// subscription pairs a Subscriber callback with an opaque id used to
// remove it on unsubscribe. Slice rather than map because iteration is
// the hot path and the active subscriber count is small (a few at most:
// the WebSocket hub plus any other durable subscribers).
type subscription struct {
	id uint64
	fn Subscriber
}

type Store struct {
	mu       sync.RWMutex
	comments map[string]*Comment
	// loadedDirs tracks which project directories have been loaded from
	// disk, enabling lazy per-directory loading without double-loading.
	loadedDirs map[string]bool

	subsMu    sync.RWMutex
	subs      []subscription
	nextSubID uint64
}

func NewStore() *Store {
	return &Store{
		comments:   make(map[string]*Comment),
		loadedDirs: make(map[string]bool),
	}
}

// Subscribe registers a durable callback that fires on every AddComment.
// Returns an unsubscribe function the caller must invoke when done; the
// store does not auto-remove subscribers. The WebSocket hub registers
// once at startup so the UI re-fetches comments whenever an agent reply
// or other server-side write lands. It never unsubscribes.
//
// The unsubscribe function is idempotent and safe to call after the
// store has been cleared.
func (s *Store) Subscribe(fn Subscriber) func() {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()
	s.nextSubID++
	id := s.nextSubID
	s.subs = append(s.subs, subscription{id: id, fn: fn})
	return func() {
		s.subsMu.Lock()
		defer s.subsMu.Unlock()
		for i, sub := range s.subs {
			if sub.id == id {
				s.subs = append(s.subs[:i], s.subs[i+1:]...)
				return
			}
		}
	}
}

// snapshotSubscribers copies the current subscriber list so the caller
// can iterate without holding the lock — important because subscriber
// callbacks may attempt to subscribe or unsubscribe.
func (s *Store) snapshotSubscribers() []subscription {
	s.subsMu.RLock()
	defer s.subsMu.RUnlock()
	out := make([]subscription, len(s.subs))
	copy(out, s.subs)
	return out
}

// AddComment assigns an ID, applies defaults, and stores the comment.
// Callers may post partial payloads; Author defaults to "user" and Status
// defaults to "open" so existing UI clients written before these fields
// existed continue to work unmodified.
func (s *Store) AddComment(comment *Comment) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if comment.Author == "" {
		comment.Author = AuthorUser
	}
	if comment.Status == "" {
		comment.Status = StatusOpen
	}

	comment.ID = generateID()
	comment.CreatedAt = time.Now()
	s.comments[comment.ID] = comment

	// Fan out to durable subscribers off the write path. AddComment
	// returns immediately; subscribers run concurrently in their own
	// goroutines. Filtering (user vs agent, status) is the subscriber's
	// responsibility — the store delivers every AddComment to every
	// active subscriber.
	for _, sub := range s.snapshotSubscribers() {
		go sub.fn(comment)
	}
}

func (s *Store) GetComments(file string) []*Comment {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var comments []*Comment
	for _, c := range s.comments {
		if c.File == file {
			comments = append(comments, c)
		}
	}
	return comments
}

func (s *Store) GetAllComments() []*Comment {
	s.mu.RLock()
	defer s.mu.RUnlock()

	comments := make([]*Comment, 0, len(s.comments))
	for _, c := range s.comments {
		comments = append(comments, c)
	}
	return comments
}

// GetByID returns the comment with the given ID, or nil if no such
// comment exists. The returned pointer is the live store entry and should
// be treated as read-only.
func (s *Store) GetByID(id string) *Comment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.comments[id]
}

// GetCommentsByStatus returns comments with the given status. Used by the
// /comments/open and /comments/resolved HTTP routes.
func (s *Store) GetCommentsByStatus(status string) []*Comment {
	s.mu.RLock()
	defer s.mu.RUnlock()

	comments := make([]*Comment, 0)
	for _, c := range s.comments {
		if c.Status == status {
			comments = append(comments, c)
		}
	}
	return comments
}

// UpdateContent replaces the text of a comment. Returns false if not found.
func (s *Store) UpdateContent(id, content string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.comments[id]
	if !ok {
		return false
	}
	c.Content = content
	return true
}

// SetStatus updates a comment's status. Returns false if the comment was
// not found. Resolution is invoked from the UI; the agent has no tool to
// flip status.
func (s *Store) SetStatus(id, status string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	c, ok := s.comments[id]
	if !ok {
		return false
	}
	c.Status = status
	return true
}

// DeleteComment removes a comment and, if the target is a thread root,
// cascades the removal to every reply. Single deletions of replies
// remove only the reply.
//
// Fires subscribers with a nil comment so the WS hub broadcasts a
// comment_changed event and connected browser tabs re-fetch. The
// cascade-for-roots behavior is what keeps the UI thread coherent: a
// user clicking × on a parent must not leave the agent's reply
// orphaned in the diff view.
func (s *Store) DeleteComment(id string) bool {
	s.mu.Lock()

	c, exists := s.comments[id]
	if !exists {
		s.mu.Unlock()
		return false
	}
	delete(s.comments, id)
	if c.ParentID == "" {
		for childID, child := range s.comments {
			if child.ParentID == id {
				delete(s.comments, childID)
			}
		}
	}
	s.mu.Unlock()

	for _, sub := range s.snapshotSubscribers() {
		go sub.fn(nil)
	}
	return true
}

// GetCommentsForDir returns all comments for a specific directory, loading
// from disk on first access (lazy load).
func (s *Store) GetCommentsForDir(dir string) []*Comment {
	s.ensureLoaded(dir)
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*Comment
	for _, c := range s.comments {
		if c.Directory == dir {
			out = append(out, c)
		}
	}
	return out
}

// ClearForDir removes all in-memory comments for the given directory.
func (s *Store) ClearForDir(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, c := range s.comments {
		if c.Directory == dir {
			delete(s.comments, id)
		}
	}
}

// ensureLoaded lazily loads comments from disk for the given directory if
// not yet loaded into memory.
func (s *Store) ensureLoaded(dir string) {
	s.mu.RLock()
	loaded := s.loadedDirs[dir]
	s.mu.RUnlock()
	if !loaded {
		_ = s.LoadComments(dir)
	}
}

// Clear removes all comments from the store
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.comments = make(map[string]*Comment)
}

func generateID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback to timestamp if crypto/rand fails
		return time.Now().Format("20060102150405.999999999")
	}
	return hex.EncodeToString(b)
}
