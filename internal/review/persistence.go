package review

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

func vibediffConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".config", "vibediff", "comments")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func projectCommentsFile(projectDir string) (string, error) {
	configDir, err := vibediffConfigDir()
	if err != nil {
		return "", err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(projectDir)))[:16]
	return filepath.Join(configDir, hash+".json"), nil
}

// SaveComments persists all comments for the given project directory to disk.
// Only comments whose Directory field matches projectDir are written.
func (s *Store) SaveComments(projectDir string) error {
	if projectDir == "" {
		return nil
	}
	file, err := projectCommentsFile(projectDir)
	if err != nil {
		return err
	}

	s.mu.RLock()
	comments := make([]*Comment, 0)
	for _, c := range s.comments {
		if c.Directory == projectDir {
			comments = append(comments, c)
		}
	}
	s.mu.RUnlock()

	data, err := json.MarshalIndent(comments, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, data, 0o644)
}

// LoadComments merges comments from disk for the given project directory into
// the store, stamping each with Directory = projectDir. Unlike the old
// implementation this does NOT clear the store, so multiple directories can
// coexist in memory. Each directory is loaded at most once (tracked via
// loadedDirs); subsequent calls for the same dir are no-ops.
func (s *Store) LoadComments(projectDir string) error {
	if projectDir == "" {
		return nil
	}

	file, err := projectCommentsFile(projectDir)
	if err != nil {
		return err
	}

	data, err := os.ReadFile(file)
	if os.IsNotExist(err) {
		// Mark as loaded even when no file exists.
		s.mu.Lock()
		if s.loadedDirs == nil {
			s.loadedDirs = make(map[string]bool)
		}
		s.loadedDirs[projectDir] = true
		s.mu.Unlock()
		return nil
	}
	if err != nil {
		return err
	}

	var comments []*Comment
	if err := json.Unmarshal(data, &comments); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadedDirs == nil {
		s.loadedDirs = make(map[string]bool)
	}
	if s.tombstones == nil {
		s.tombstones = make(map[string]time.Time)
	}
	// Merge: stamp Directory and add to in-memory store.
	for _, c := range comments {
		if c != nil {
			c.Directory = projectDir
			s.comments[c.ID] = c
		}
	}
	s.loadedDirs[projectDir] = true
	return nil
}
