package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Registry stores the list of known project directories, persisted to disk.
type Registry struct {
	mu   sync.RWMutex
	dirs []string
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
	for _, d := range r.dirs {
		if d == dir {
			return false
		}
	}
	r.dirs = append(r.dirs, dir)
	_ = r.save()
	return true
}

// Remove removes a directory from the registry. Returns false if not found.
func (r *Registry) Remove(dir string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, d := range r.dirs {
		if d == dir {
			r.dirs = append(r.dirs[:i], r.dirs[i+1:]...)
			_ = r.save()
			return true
		}
	}
	return false
}

// List returns a snapshot of all registered directories.
func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, len(r.dirs))
	copy(out, r.dirs)
	return out
}

// Reorder replaces the directory list with dirs. Returns false if dirs does
// not match the current set (same elements, different order).
func (r *Registry) Reorder(dirs []string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(dirs) != len(r.dirs) {
		return false
	}
	existing := make(map[string]struct{}, len(r.dirs))
	for _, d := range r.dirs {
		existing[d] = struct{}{}
	}
	for _, d := range dirs {
		if _, ok := existing[d]; !ok {
			return false
		}
	}
	r.dirs = dirs
	_ = r.save()
	return true
}

// Contains reports whether dir is in the registry.
func (r *Registry) Contains(dir string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, d := range r.dirs {
		if d == dir {
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

func (r *Registry) load() error {
	if r.file == "" {
		return nil
	}
	data, err := os.ReadFile(r.file)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &r.dirs)
}

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
