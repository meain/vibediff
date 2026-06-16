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
func (s *Store) SaveComments(projectDir string) error {
	if projectDir == "" {
		return nil
	}
	file, err := projectCommentsFile(projectDir)
	if err != nil {
		return err
	}

	s.mu.RLock()
	comments := make([]*Comment, 0, len(s.comments))
	for _, c := range s.comments {
		comments = append(comments, c)
	}
	s.mu.RUnlock()

	data, err := json.MarshalIndent(comments, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, data, 0o644)
}

// LoadComments replaces the store contents with comments loaded from disk for
// the given project directory. If no saved file exists the store is cleared.
func (s *Store) LoadComments(projectDir string) error {
	if projectDir == "" {
		s.Clear()
		return nil
	}
	file, err := projectCommentsFile(projectDir)
	if err != nil {
		return err
	}

	data, err := os.ReadFile(file)
	if os.IsNotExist(err) {
		s.Clear()
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
	s.comments = make(map[string]*Comment, len(comments))
	s.tombstones = make(map[string]time.Time)
	for _, c := range comments {
		if c != nil {
			s.comments[c.ID] = c
		}
	}
	return nil
}
