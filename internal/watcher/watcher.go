package watcher

import (
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/malvex/vibediff/internal/git"
)

// ChangeNotifier interface for notifying changes (includes directory).
type ChangeNotifier interface {
	NotifyChange(changeType string, dir string)
}

// DirectoryLister provides the list of directories to watch.
type DirectoryLister interface {
	List() []string
}

// GitWatcher monitors VCS status for changes across all registered directories.
type GitWatcher struct {
	hub          ChangeNotifier
	service      *git.Service
	registry     DirectoryLister
	lastStatus   map[string]string
	pollInterval time.Duration
	done         chan bool
	mu           sync.Mutex
}

// NewGitWatcher creates a new multi-directory VCS watcher.
func NewGitWatcher(hub ChangeNotifier, service *git.Service, registry DirectoryLister) *GitWatcher {
	return &GitWatcher{
		hub:          hub,
		service:      service,
		registry:     registry,
		lastStatus:   make(map[string]string),
		pollInterval: 1 * time.Second,
		done:         make(chan bool),
	}
}

// Start begins monitoring for changes.
func (w *GitWatcher) Start() {
	go func() {
		ticker := time.NewTicker(w.pollInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				w.checkAllDirs()
			case <-w.done:
				if os.Getenv("VIBEDIFF_DEBUG") == "true" {
					log.Println("VCS watcher stopped")
				}
				return
			}
		}
	}()
}

// Stop stops the watcher.
func (w *GitWatcher) Stop() {
	select {
	case <-w.done:
		// Already closed
	default:
		close(w.done)
	}
}

func (w *GitWatcher) checkAllDirs() {
	dirs := w.registry.List()
	for _, dir := range dirs {
		w.checkDir(dir)
	}
}

func (w *GitWatcher) checkDir(dir string) {
	output, err := w.service.StatusRaw(dir)
	if err != nil {
		if os.Getenv("VIBEDIFF_DEBUG") == "true" {
			log.Printf("Error checking VCS status for %s: %v", dir, err)
		}
		return
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	last := w.lastStatus[dir]
	if output == last {
		return
	}
	w.lastStatus[dir] = output

	backend := w.service.GetBackend(dir)
	changeType := "file_changed"
	if backend == git.BackendJJ {
		if strings.Contains(output, "A ") {
			changeType = "file_added"
		} else if strings.Contains(output, "D ") {
			changeType = "file_deleted"
		}
	} else {
		if strings.Contains(output, "??") {
			changeType = "file_added"
		} else if strings.Contains(output, " D ") {
			changeType = "file_deleted"
		}
	}

	w.hub.NotifyChange(changeType, dir)
}
