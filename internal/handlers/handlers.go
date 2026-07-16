package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gorilla/mux"

	"github.com/malvex/vibediff/internal/git"
	"github.com/malvex/vibediff/internal/registry"
	"github.com/malvex/vibediff/internal/review"
)

type Handler struct {
	gitService  *git.Service
	reviewStore *review.Store
	registry    *registry.Registry
}

func NewHandler(gitService *git.Service, reviewStore *review.Store, reg *registry.Registry) *Handler {
	return &Handler{
		gitService:  gitService,
		reviewStore: reviewStore,
		registry:    reg,
	}
}

// writeJSON is a helper method to reduce repetitive JSON response code
func (h *Handler) writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// dirFromQuery extracts the required "directory" query parameter.
func dirFromQuery(r *http.Request) (string, error) {
	dir := r.URL.Query().Get("directory")
	if dir == "" {
		return "", fmt.Errorf("directory parameter is required")
	}
	return dir, nil
}

func (h *Handler) GetDiff(w http.ResponseWriter, r *http.Request) {
	dir, err := dirFromQuery(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Check if a specific revision is requested
	revision := r.URL.Query().Get("revision")
	if revision != "" {
		diff, err := h.gitService.GetRevisionDiff(dir, revision)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		result := map[string]interface{}{
			"files":    diff.Files,
			"type":     diff.Type,
			"revision": revision,
		}
		h.writeJSON(w, result)
		return
	}

	diffType := git.DiffType(r.URL.Query().Get("type"))
	if diffType == "" {
		diffType = git.DiffTypeAll
	}

	diff, err := h.gitService.GetDiff(dir, diffType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	result := map[string]interface{}{
		"files": diff.Files,
		"type":  diffType,
	}

	h.writeJSON(w, result)
}

func (h *Handler) GetRevisions(w http.ResponseWriter, r *http.Request) {
	dir, err := dirFromQuery(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := fmt.Sscanf(l, "%d", &limit); err != nil || n != 1 {
			limit = 50
		}
	}

	revisions, err := h.gitService.GetRevisions(dir, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, revisions)
}

func (h *Handler) GetFileDiff(w http.ResponseWriter, r *http.Request) {
	dir, err := dirFromQuery(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	vars := mux.Vars(r)
	filename, err := url.QueryUnescape(vars["file"])
	if err != nil {
		http.Error(w, "Invalid file path", http.StatusBadRequest)
		return
	}

	diffType := git.DiffType(r.URL.Query().Get("type"))
	if diffType == "" {
		diffType = git.DiffTypeAll
	}

	diff, err := h.gitService.GetFileDiff(dir, filename, diffType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, diff)
}

// validateComment checks required fields and enum values on an incoming
// comment payload, returning a descriptive error string on the first
// violation so API callers get actionable feedback.
func validateComment(c *review.Comment) error {
	if strings.TrimSpace(c.Content) == "" {
		return fmt.Errorf("content is required")
	}
	if c.ParentID == "" {
		// Root comment rules
		if strings.TrimSpace(c.File) == "" {
			return fmt.Errorf("file is required for root comments (without it the comment cannot be anchored to a diff line and will not appear in the UI)")
		}
		if c.Line <= 0 {
			return fmt.Errorf("line must be a positive integer")
		}
	}
	if c.Author != "" && c.Author != review.AuthorUser && c.Author != review.AuthorAgent {
		return fmt.Errorf("author must be %q or %q, got %q", review.AuthorUser, review.AuthorAgent, c.Author)
	}
	if len(c.AuthorName) > 50 {
		return fmt.Errorf("author_name must be 50 characters or fewer")
	}
	if c.Status != "" && c.Status != review.StatusOpen && c.Status != review.StatusResolved {
		return fmt.Errorf("status must be %q or %q, got %q", review.StatusOpen, review.StatusResolved, c.Status)
	}
	return nil
}

func (h *Handler) AddComment(w http.ResponseWriter, r *http.Request) {
	var comment review.Comment
	if err := json.NewDecoder(r.Body).Decode(&comment); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if comment.Directory == "" {
		http.Error(w, "directory is required", http.StatusBadRequest)
		return
	}

	if err := validateComment(&comment); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Default lineEnd to line when not provided so the frontend's
	// getCommentsForLine filter (which keys on lineEnd) can find the comment.
	if comment.LineEnd == 0 {
		comment.LineEnd = comment.Line
	}

	// When parentId is set, inherit file/line/lineEnd/revision/directory from
	// the parent so callers only need to supply content and parentId.
	if comment.ParentID != "" {
		parent := h.reviewStore.GetByID(comment.ParentID)
		if parent == nil {
			http.Error(w, "parent comment not found", http.StatusBadRequest)
			return
		}
		if comment.File == "" {
			comment.File = parent.File
		}
		if comment.Line == 0 {
			comment.Line = parent.Line
		}
		if comment.LineEnd == 0 {
			comment.LineEnd = parent.LineEnd
		}
		if comment.Revision == "" {
			comment.Revision = parent.Revision
		}
		if comment.Directory == "" {
			comment.Directory = parent.Directory
		}
	}

	// Pin the underlying commit SHA so the comment remains anchored to
	// the code the user was looking at.
	if comment.Commit == "" {
		if sha, err := h.gitService.ResolveCommit(comment.Directory, comment.Revision); err == nil {
			comment.Commit = sha
		}
	}

	h.reviewStore.AddComment(&comment)
	_ = h.reviewStore.SaveComments(comment.Directory)
	h.writeJSON(w, comment)
}

func (h *Handler) GetComments(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("directory")
	file := r.URL.Query().Get("file")
	revision := r.URL.Query().Get("revision")

	var comments []*review.Comment
	if dir != "" {
		// Lazy-load this directory and return its comments.
		comments = h.reviewStore.GetCommentsForDir(dir)
		if file != "" {
			filtered := make([]*review.Comment, 0)
			for _, c := range comments {
				if c.File == file {
					filtered = append(filtered, c)
				}
			}
			comments = filtered
		}
	} else if file != "" {
		comments = h.reviewStore.GetComments(file)
	} else {
		comments = h.reviewStore.GetAllComments()
	}

	// Filter by revision when requested:
	//   revision="" (absent)        → return all comments (backward compat)
	//   revision="working-copy"     → comments with no revision tag
	//   revision=<id>               → comments tagged with that revision
	if revision != "" {
		filtered := make([]*review.Comment, 0)
		for _, c := range comments {
			if revision == "working-copy" {
				if c.Revision == "" {
					filtered = append(filtered, c)
				}
			} else if c.Revision == revision {
				filtered = append(filtered, c)
			}
		}
		comments = filtered
	}

	if comments == nil {
		comments = []*review.Comment{}
	}
	h.writeJSON(w, comments)
}

// GetOpenComments returns all comments with status "open".
func (h *Handler) GetOpenComments(w http.ResponseWriter, r *http.Request) {
	h.writeJSON(w, h.reviewStore.GetCommentsByStatus(review.StatusOpen))
}

// GetResolvedComments returns all comments with status "resolved".
func (h *Handler) GetResolvedComments(w http.ResponseWriter, r *http.Request) {
	h.writeJSON(w, h.reviewStore.GetCommentsByStatus(review.StatusResolved))
}

// GetLatestComment returns the single most recently created open comment,
// or 404 if none exist. Intended for hook scripts polling for new arrivals.
func (h *Handler) GetLatestComment(w http.ResponseWriter, r *http.Request) {
	c := h.reviewStore.LatestOpenComment()
	if c == nil {
		http.Error(w, "no open comments", http.StatusNotFound)
		return
	}
	h.writeJSON(w, c)
}

// UpdateComment replaces the content of an existing comment.
func (h *Handler) UpdateComment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	var req struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Content == "" {
		http.Error(w, "content is required", http.StatusBadRequest)
		return
	}
	// Look up the comment first to get its directory for persisting.
	c := h.reviewStore.GetByID(vars["id"])
	if c == nil {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	dir := c.Directory
	if !h.reviewStore.UpdateContent(vars["id"], req.Content) {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	_ = h.reviewStore.SaveComments(dir)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteComment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	// Look up the comment first to know which directory to persist.
	c := h.reviewStore.GetByID(id)
	if c == nil {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	dir := c.Directory

	if h.reviewStore.DeleteComment(id) {
		_ = h.reviewStore.SaveComments(dir)
		w.WriteHeader(http.StatusNoContent)
	} else {
		http.Error(w, "Comment not found", http.StatusNotFound)
	}
}

// ClearAllComments removes comments from the store.
// If ?directory=... is provided, only that directory's comments are cleared.
// Otherwise all comments are cleared (backward compat for tests/scripts).
func (h *Handler) ClearAllComments(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("directory")
	if dir != "" {
		h.reviewStore.ClearForDir(dir)
		_ = h.reviewStore.SaveComments(dir)
	} else {
		h.reviewStore.Clear()
	}
	w.WriteHeader(http.StatusNoContent)
}

// ResolveComment marks a comment as resolved.
func (h *Handler) ResolveComment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	c := h.reviewStore.GetByID(vars["id"])
	if c == nil {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	dir := c.Directory
	if !h.reviewStore.SetStatus(vars["id"], review.StatusResolved) {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	_ = h.reviewStore.SaveComments(dir)
	w.WriteHeader(http.StatusNoContent)
}

// ReopenComment transitions a comment back to open.
func (h *Handler) ReopenComment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	c := h.reviewStore.GetByID(vars["id"])
	if c == nil {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	dir := c.Directory
	if !h.reviewStore.SetStatus(vars["id"], review.StatusOpen) {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	_ = h.reviewStore.SaveComments(dir)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetFullFileWithDiff(w http.ResponseWriter, r *http.Request) {
	dir, err := dirFromQuery(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	vars := mux.Vars(r)
	filename, err := url.QueryUnescape(vars["file"])
	if err != nil {
		http.Error(w, "Invalid file path", http.StatusBadRequest)
		return
	}

	revision := r.URL.Query().Get("revision")
	if revision != "" {
		diff, err := h.gitService.GetRevisionFileDiffWithFullContext(dir, filename, revision)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		h.writeJSON(w, diff)
		return
	}

	diffType := git.DiffType(r.URL.Query().Get("type"))
	if diffType == "" {
		diffType = git.DiffTypeAll
	}

	diff, err := h.gitService.GetFileDiffWithFullContext(dir, filename, diffType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, diff)
}

func (h *Handler) GetFileContent(w http.ResponseWriter, r *http.Request) {
	dir, err := dirFromQuery(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "Missing file path", http.StatusBadRequest)
		return
	}

	content, err := h.gitService.GetFileContent(dir, filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read file: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if _, err := w.Write([]byte(content)); err != nil {
		log.Printf("Failed to write file content: %v", err)
	}
}

// GetConfig returns static server configuration useful to the frontend.
func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	homeDir, _ := os.UserHomeDir()
	h.writeJSON(w, map[string]string{
		"homeDir": homeDir,
	})
}

// GetDirectoryInfo returns backend info for a specific directory.
func (h *Handler) GetDirectoryInfo(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("directory")
	if dir == "" {
		http.Error(w, "directory parameter is required", http.StatusBadRequest)
		return
	}
	backend := h.gitService.GetBackend(dir)
	h.writeJSON(w, map[string]string{
		"directory": dir,
		"backend":   string(backend),
	})
}

// ListDirectories returns all registered directories.
func (h *Handler) ListDirectories(w http.ResponseWriter, r *http.Request) {
	dirs := h.registry.List()
	if dirs == nil {
		dirs = []string{}
	}
	h.writeJSON(w, dirs)
}

// RegisterDirectory validates and adds a directory to the registry.
func (h *Handler) RegisterDirectory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Directory string `json:"directory"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Directory == "" {
		http.Error(w, "directory is required", http.StatusBadRequest)
		return
	}

	if err := h.gitService.ValidateRepo(req.Directory); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.registry.Add(req.Directory)
	// Eagerly load comments for the new directory.
	_ = h.reviewStore.LoadComments(req.Directory)
	backend := h.gitService.GetBackend(req.Directory)
	h.writeJSON(w, map[string]string{
		"directory": req.Directory,
		"backend":   string(backend),
	})
}

// ReorderDirectories replaces the registry list with the provided order.
func (h *Handler) ReorderDirectories(w http.ResponseWriter, r *http.Request) {
	var dirs []string
	if err := json.NewDecoder(r.Body).Decode(&dirs); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if !h.registry.Reorder(dirs) {
		http.Error(w, "reorder list does not match registered directories", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RemoveDirectory removes a directory from the registry.
func (h *Handler) RemoveDirectory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	dirEncoded := vars["path"]
	dir, err := url.QueryUnescape(dirEncoded)
	if err != nil {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	h.registry.Remove(dir)
	w.WriteHeader(http.StatusNoContent)
}

// ValidateDirectory validates a directory is a git or jj repo without adding it.
func (h *Handler) ValidateDirectory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Directory string `json:"directory"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	err := h.gitService.ValidateGitRepo(req.Directory)
	result := map[string]interface{}{
		"valid": err == nil,
	}
	if err != nil {
		result["error"] = err.Error()
	}
	h.writeJSON(w, result)
}
