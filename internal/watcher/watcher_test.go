package watcher

import (
	"testing"
)

func TestMatchDir(t *testing.T) {
	dirs := map[string]bool{
		"/a/foo":     true,
		"/a/foobar":  true,
		"/a/foo/sub": true,
		"/b/":        true,
	}

	tests := []struct {
		path string
		want string
	}{
		{"/a/foo/file.txt", "/a/foo"},
		{"/a/foobar/file.txt", "/a/foobar"},
		{"/a/foo", "/a/foo"},
		{"/a/foobar", "/a/foobar"},
		{"/a/foo/sub/x.go", "/a/foo/sub"},
		{"/a/foo/subway/x.go", "/a/foo"},
		{"/b/x", "/b/"},
		{"/a/fo", ""},
		{"/a/foobaz/x", ""},
		{"/c/x", ""},
	}

	for _, tt := range tests {
		// Repeat to shake out map-order nondeterminism.
		for range 20 {
			if got := matchDir(tt.path, dirs); got != tt.want {
				t.Fatalf("matchDir(%q) = %q, want %q", tt.path, got, tt.want)
			}
		}
	}
}

type countingHub struct {
	clients int
}

func (h *countingHub) NotifyChange(string, string) {}
func (h *countingHub) ClientCount() int            { return h.clients }

type panicLister struct{}

func (panicLister) List() []string { panic("List should not be called with no clients") }

func TestCheckAllRevisionsSkipsWithoutClients(t *testing.T) {
	hub := &countingHub{clients: 0}
	w := NewGitWatcher(hub, nil, panicLister{})
	w.checkAllRevisions() // must return before touching registry/service
}
