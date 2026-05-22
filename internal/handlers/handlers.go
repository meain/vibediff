package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"

	"github.com/gorilla/mux"

	"github.com/malvex/vibediff/internal/git"
	"github.com/malvex/vibediff/internal/review"
)

type Handler struct {
	gitService  *git.Service
	reviewStore *review.Store
	watcher     interface {
		SetWorkingDir(string)
		SetBackend(git.VCSBackend)
	}
}

func NewHandler(gitService *git.Service, reviewStore *review.Store, watcher interface {
	SetWorkingDir(string)
	SetBackend(git.VCSBackend)
}) *Handler {
	return &Handler{
		gitService:  gitService,
		reviewStore: reviewStore,
		watcher:     watcher,
	}
}

// writeJSON is a helper method to reduce repetitive JSON response code
func (h *Handler) writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (h *Handler) GetDiff(w http.ResponseWriter, r *http.Request) {
	// Check if a specific revision is requested
	revision := r.URL.Query().Get("revision")
	if revision != "" {
		diff, err := h.gitService.GetRevisionDiff(revision)
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

	diff, err := h.gitService.GetDiff(diffType)
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
	if r.URL.Query().Get("all") == "true" {
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if n, err := fmt.Sscanf(l, "%d", &limit); err != nil || n != 1 {
				limit = 50
			}
		}
		revisions, err := h.gitService.GetRevisions(limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		h.writeJSON(w, revisions)
		return
	}

	revisions, err := h.gitService.GetRevisionsFromTrunk()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.writeJSON(w, revisions)
}

// GetRevisionDetail returns full metadata for a single revision.
func (h *Handler) GetRevisionDetail(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	detail, err := h.gitService.GetRevisionDetail(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, detail)
}

type describeRequest struct {
	Description string `json:"description"`
}

// DescribeRevision sets the description of the specified jj revision.
func (h *Handler) DescribeRevision(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var req describeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "missing description", http.StatusBadRequest)
		return
	}

	if err := h.gitService.DescribeRevision(id, req.Description); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type renameBookmarkRequest struct {
	Name string `json:"name"`
}

// RenameBookmark renames a jj bookmark.
func (h *Handler) RenameBookmark(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	oldName, err := url.PathUnescape(vars["name"])
	if err != nil {
		http.Error(w, "invalid bookmark name", http.StatusBadRequest)
		return
	}

	var req renameBookmarkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		http.Error(w, "missing name", http.StatusBadRequest)
		return
	}

	if err := h.gitService.RenameBookmark(oldName, req.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteBookmark deletes a jj bookmark.
func (h *Handler) DeleteBookmark(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	name, err := url.PathUnescape(vars["name"])
	if err != nil {
		http.Error(w, "invalid bookmark name", http.StatusBadRequest)
		return
	}

	if err := h.gitService.DeleteBookmark(name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SquashRevision squashes the specified revision into its parent.
func (h *Handler) SquashRevision(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]
	if err := h.gitService.SquashRevision(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type newRevisionRequest struct {
	Bookmarks []string `json:"bookmarks"`
}

// NewRevisionAfter creates a new empty revision after the specified one,
// inserting it into the stack and optionally moving bookmarks to it.
func (h *Handler) NewRevisionAfter(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	var req newRevisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Bookmarks = []string{}
	}

	if err := h.gitService.NewRevisionAfter(id, req.Bookmarks); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetFileDiff(w http.ResponseWriter, r *http.Request) {
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

	diff, err := h.gitService.GetFileDiff(filename, diffType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, diff)
}

func (h *Handler) AddComment(w http.ResponseWriter, r *http.Request) {
	var comment review.Comment
	if err := json.NewDecoder(r.Body).Decode(&comment); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Pin the underlying commit SHA so the comment remains anchored to
	// the code the user was looking at, even after working-copy edits.
	// Best-effort: on resolve failure, leave Commit empty.
	if comment.Commit == "" {
		if sha, err := h.gitService.ResolveCommit(comment.Revision); err == nil {
			comment.Commit = sha
		}
	}

	h.reviewStore.AddComment(&comment)
	h.writeJSON(w, comment)
}

func (h *Handler) GetComments(w http.ResponseWriter, r *http.Request) {
	file := r.URL.Query().Get("file")

	var comments []*review.Comment
	if file != "" {
		comments = h.reviewStore.GetComments(file)
	} else {
		comments = h.reviewStore.GetAllComments()
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

func (h *Handler) DeleteComment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	if h.reviewStore.DeleteComment(id) {
		w.WriteHeader(http.StatusNoContent)
	} else {
		http.Error(w, "Comment not found", http.StatusNotFound)
	}
}

// ResolveComment marks a comment as resolved. Driven by the UI; the agent
// has no equivalent tool.
func (h *Handler) ResolveComment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if !h.reviewStore.SetStatus(vars["id"], review.StatusResolved) {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ReopenComment transitions a comment back to open. Useful when the user
// resolved by accident or wants to re-engage the agent on a previously
// closed thread.
func (h *Handler) ReopenComment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if !h.reviewStore.SetStatus(vars["id"], review.StatusOpen) {
		http.Error(w, "Comment not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetFullFileWithDiff(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	filename, err := url.QueryUnescape(vars["file"])
	if err != nil {
		http.Error(w, "Invalid file path", http.StatusBadRequest)
		return
	}

	revision := r.URL.Query().Get("revision")
	if revision != "" {
		diff, err := h.gitService.GetRevisionFileDiffWithFullContext(filename, revision)
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

	diff, err := h.gitService.GetFileDiffWithFullContext(filename, diffType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, diff)
}

func (h *Handler) GetFileContent(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "Missing file path", http.StatusBadRequest)
		return
	}

	content, err := h.gitService.GetFileContent(filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read file: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if _, err := w.Write([]byte(content)); err != nil {
		log.Printf("Failed to write file content: %v", err)
	}
}

// GetDirectory returns the current working directory and backend info
func (h *Handler) GetDirectory(w http.ResponseWriter, r *http.Request) {
	dir := h.gitService.GetWorkingDir()
	h.writeJSON(w, map[string]string{
		"directory": dir,
		"backend":   string(h.gitService.GetBackend()),
	})
}

// SetDirectory changes the working directory
func (h *Handler) SetDirectory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Directory string `json:"directory"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.gitService.SetWorkingDir(req.Directory); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.watcher.SetWorkingDir(req.Directory)
	h.watcher.SetBackend(h.gitService.GetBackend())
	h.reviewStore.Clear()

	h.writeJSON(w, map[string]string{
		"directory": req.Directory,
		"backend":   string(h.gitService.GetBackend()),
	})
}

// ValidateDirectory validates a directory is a git or jj repo
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
