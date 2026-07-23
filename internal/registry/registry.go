package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Entry is a single registered directory along with its optional display
// alias.
type Entry struct {
	Path  string `json:"path"`
	Alias string `json:"alias,omitempty"`
}

// Registry stores the list of known project directories, persisted to disk.
type Registry struct {
	mu   sync.RWMutex
	dirs []Entry
	file string
}

// New creates a Registry and loads any persisted directories from disk.
func New() *Registry {
	r := &Registry{file: persistPath()}
	_ = r.load()
	return r
}

// Add appends a directory to the registry if not already present. Returns true if added.
func (r *Registry) Add(dir string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, e := range r.dirs {
		if e.Path == dir {
			return false
		}
	}
	r.dirs = append(r.dirs, Entry{Path: dir})
	_ = r.save()
	return true
}

// Remove removes a directory from the registry. Returns false if not found.
func (r *Registry) Remove(dir string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, e := range r.dirs {
		if e.Path == dir {
			r.dirs = append(r.dirs[:i], r.dirs[i+1:]...)
			_ = r.save()
			return true
		}
	}
	return false
}

// List returns a snapshot of all registered directory paths. Kept path-only
// to satisfy existing consumers (e.g. watcher.DirectoryLister) that only
// need paths, not aliases.
func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	paths := make([]string, len(r.dirs))
	for i, e := range r.dirs {
		paths[i] = e.Path
	}
	return paths
}

// ListEntries returns a snapshot of all registered directories, each paired
// with its display alias (empty if unset).
func (r *Registry) ListEntries() []Entry {
	r.mu.RLock()
	defer r.mu.RUnlock()

	entries := make([]Entry, len(r.dirs))
	copy(entries, r.dirs)
	return entries
}

// Reorder replaces the directory order with dirs (a list of paths),
// preserving each entry's existing alias. Returns false if dirs does not
// match the current set (same paths, different order).
func (r *Registry) Reorder(dirs []string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(dirs) != len(r.dirs) {
		return false
	}

	byPath := make(map[string]Entry, len(r.dirs))
	for _, e := range r.dirs {
		byPath[e.Path] = e
	}

	reordered := make([]Entry, len(dirs))
	for i, path := range dirs {
		e, ok := byPath[path]
		if !ok {
			return false
		}
		reordered[i] = e
	}

	r.dirs = reordered
	_ = r.save()
	return true
}

// Contains reports whether dir is in the registry.
func (r *Registry) Contains(dir string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, e := range r.dirs {
		if e.Path == dir {
			return true
		}
	}
	return false
}

// SetAlias sets (or, given an empty alias, clears) the display alias for
// path. Returns false if path is not registered.
func (r *Registry) SetAlias(path, alias string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, e := range r.dirs {
		if e.Path == path {
			r.dirs[i].Alias = alias
			_ = r.save()
			return true
		}
	}
	return false
}

func persistPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	dir := filepath.Join(home, ".config", "vibediff")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ""
	}
	return filepath.Join(dir, "directories.json")
}

// load reads the persisted directory list from disk, migrating a legacy
// plain-string-array format ([]string) into []Entry (alias "") on the fly.
// The migrated shape is kept in memory only; it is not written back to disk
// until the next save() call triggered by a subsequent mutation.
func (r *Registry) load() error {
	if r.file == "" {
		return nil
	}

	data, err := os.ReadFile(r.file)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var entries []Entry
	if err := json.Unmarshal(data, &entries); err == nil {
		r.dirs = entries
		return nil
	}

	var paths []string
	if err := json.Unmarshal(data, &paths); err != nil {
		return err
	}

	entries = make([]Entry, len(paths))
	for i, p := range paths {
		entries[i] = Entry{Path: p}
	}
	r.dirs = entries
	return nil
}

// save persists the current directory list to disk in the []Entry format.
func (r *Registry) save() error {
	if r.file == "" {
		return nil
	}

	data, err := json.MarshalIndent(r.dirs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(r.file, data, 0o644)
}
