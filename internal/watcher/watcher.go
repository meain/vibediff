package watcher

import (
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
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
	hub         ChangeNotifier
	service     *git.Service
	registry    DirectoryLister
	lastStatus  map[string]string
	done        chan bool
	mu          sync.Mutex
	fswatcher   *fsnotify.Watcher
	watchedDirs map[string]bool
}

// NewGitWatcher creates a new multi-directory VCS watcher.
func NewGitWatcher(hub ChangeNotifier, service *git.Service, registry DirectoryLister) *GitWatcher {
	return &GitWatcher{
		hub:        hub,
		service:    service,
		registry:   registry,
		lastStatus: make(map[string]string),
		done:       make(chan bool),
	}
}

// reconcileWatchers adds fsnotify watches for any newly-registered directories.
// Must only be called from the watcher goroutine.
func (w *GitWatcher) reconcileWatchers() {
	if w.fswatcher == nil {
		return
	}
	dirs := w.registry.List()
	for _, dir := range dirs {
		if !w.watchedDirs[dir] {
			if err := w.fswatcher.Add(dir); err != nil {
				if os.Getenv("VIBEDIFF_DEBUG") == "true" {
					log.Printf("fsnotify: failed to watch %s: %v", dir, err)
				}
			} else {
				w.watchedDirs[dir] = true
				if os.Getenv("VIBEDIFF_DEBUG") == "true" {
					log.Printf("fsnotify: watching %s", dir)
				}
			}
		}
	}
}

// Start begins monitoring for changes.
func (w *GitWatcher) Start() {
	go func() {
		fswatcher, err := fsnotify.NewWatcher()
		if err != nil {
			if os.Getenv("VIBEDIFF_DEBUG") == "true" {
				log.Printf("fsnotify: failed to create watcher, falling back to 5s polling: %v", err)
			}
			w.startPolling(5 * time.Second)
			return
		}
		w.fswatcher = fswatcher
		w.watchedDirs = make(map[string]bool)
		defer fswatcher.Close()

		w.reconcileWatchers()

		reconcileTicker := time.NewTicker(30 * time.Second)
		defer reconcileTicker.Stop()

		// pending holds per-dir debounce timers; only accessed in this goroutine.
		pending := make(map[string]*time.Timer)

		for {
			select {
			case event, ok := <-fswatcher.Events:
				if !ok {
					return
				}
				// Skip VCS metadata churn
				if strings.Contains(event.Name, "/.git/") || strings.Contains(event.Name, "/.jj/") {
					continue
				}
				// Find the registered dir this event belongs to
				dir := ""
				for d := range w.watchedDirs {
					if strings.HasPrefix(event.Name, d) {
						dir = d
						break
					}
				}
				if dir == "" {
					continue
				}
				// Debounce: reset the 200ms timer for this dir
				if t, ok := pending[dir]; ok {
					t.Stop()
				}
				capturedDir := dir
				pending[capturedDir] = time.AfterFunc(200*time.Millisecond, func() {
					w.checkDir(capturedDir)
				})

			case err, ok := <-fswatcher.Errors:
				if !ok {
					return
				}
				if os.Getenv("VIBEDIFF_DEBUG") == "true" {
					log.Printf("fsnotify error: %v", err)
				}

			case <-reconcileTicker.C:
				w.reconcileWatchers()

			case <-w.done:
				// Cancel all pending timers
				for _, t := range pending {
					t.Stop()
				}
				if os.Getenv("VIBEDIFF_DEBUG") == "true" {
					log.Println("VCS watcher stopped")
				}
				return
			}
		}
	}()
}

// startPolling is the fallback when fsnotify is unavailable.
func (w *GitWatcher) startPolling(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				w.checkAllDirs()
			case <-w.done:
				if os.Getenv("VIBEDIFF_DEBUG") == "true" {
					log.Println("VCS watcher stopped (polling fallback)")
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
	changeType := detectChangeType(output, backend)
	w.hub.NotifyChange(changeType, dir)
}

func detectChangeType(status string, backend git.VCSBackend) string {
	for _, line := range strings.Split(status, "\n") {
		if len(line) < 2 {
			continue
		}
		if backend == git.BackendJJ {
			// jj status lines start with "A " or "D " as the first two chars
			prefix := line[:2]
			if prefix == "A " {
				return "file_added"
			}
			if prefix == "D " {
				return "file_deleted"
			}
		} else {
			// git status --porcelain lines: "?? path" for untracked, " D path" for deleted
			if strings.HasPrefix(line, "??") {
				return "file_added"
			}
			if strings.HasPrefix(line, " D") {
				return "file_deleted"
			}
		}
	}
	return "file_changed"
}
