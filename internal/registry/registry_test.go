package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestAddListContains covers the unchanged Add/List/Contains contract that
// this feature must not break: List() still returns bare paths (plan's
// "Backend (Go)" section — watcher.DirectoryLister compatibility), Add
// dedups by path, and Contains reflects membership.
func TestAddListContains(t *testing.T) {
	testCases := []struct {
		name        string
		setup       func(r *Registry)
		add         string
		wantAdded   bool
		wantList    []string
		wantContain string
	}{
		{
			name:        "adding a new path succeeds and appears in List",
			setup:       func(r *Registry) {},
			add:         "/a/b",
			wantAdded:   true,
			wantList:    []string{"/a/b"},
			wantContain: "/a/b",
		},
		{
			name: "adding a duplicate path fails (dedup by path)",
			setup: func(r *Registry) {
				r.Add("/a/b")
			},
			add:         "/a/b",
			wantAdded:   false,
			wantList:    []string{"/a/b"},
			wantContain: "/a/b",
		},
	}

	for _, test := range testCases {
		t.Run(test.name, func(t *testing.T) {
			r := &Registry{}
			test.setup(r)

			got := r.Add(test.add)
			if got != test.wantAdded {
				t.Fatalf("Add(%q) = %v, want %v", test.add, got, test.wantAdded)
			}

			list := r.List()
			if len(list) != len(test.wantList) {
				t.Fatalf("List() = %v, want %v", list, test.wantList)
			}
			for i, p := range test.wantList {
				if list[i] != p {
					t.Fatalf("List()[%d] = %q, want %q", i, list[i], p)
				}
			}

			if !r.Contains(test.wantContain) {
				t.Fatalf("Contains(%q) = false, want true", test.wantContain)
			}
		})
	}
}

// TestSetAlias covers behavioral example 1 (alias set and displayed) and
// the plan's explicit contract that SetAlias returns false for a path that
// isn't registered, without panicking or corrupting state.
func TestSetAlias(t *testing.T) {
	testCases := []struct {
		name      string
		path      string
		alias     string
		wantOK    bool
		wantAlias string
	}{
		{
			name:      "setting an alias on a registered path succeeds",
			path:      "/home/u/proj",
			alias:     "Proj A",
			wantOK:    true,
			wantAlias: "Proj A",
		},
		{
			name:   "setting an alias on an unregistered path fails",
			path:   "/does/not/exist",
			alias:  "Ghost",
			wantOK: false,
		},
	}

	for _, test := range testCases {
		t.Run(test.name, func(t *testing.T) {
			r := &Registry{}
			r.Add("/home/u/proj")

			got := r.SetAlias(test.path, test.alias)
			if got != test.wantOK {
				t.Fatalf("SetAlias(%q, %q) = %v, want %v", test.path, test.alias, got, test.wantOK)
			}

			if test.wantOK {
				entries := r.ListEntries()
				found := false
				for _, e := range entries {
					if e.Path == test.path {
						found = true
						if e.Alias != test.wantAlias {
							t.Fatalf("entry %q alias = %q, want %q", test.path, e.Alias, test.wantAlias)
						}
					}
				}
				if !found {
					t.Fatalf("ListEntries() missing path %q after SetAlias", test.path)
				}
			} else {
				// State must not be corrupted: the one registered entry
				// should still exist, unaliased, and no phantom entry for
				// the unregistered path should appear.
				entries := r.ListEntries()
				if len(entries) != 1 {
					t.Fatalf("ListEntries() = %v, want exactly the original registered entry", entries)
				}
				if entries[0].Path != "/home/u/proj" || entries[0].Alias != "" {
					t.Fatalf("registered entry corrupted after failed SetAlias: %+v", entries[0])
				}
			}
		})
	}
}

// TestClearAlias covers behavioral example 5: SetAlias(path, "") clears a
// previously-set alias, and the entry falls back to showing the raw path
// (i.e. ListEntries reports Alias == "").
func TestClearAlias(t *testing.T) {
	testCases := []struct {
		name          string
		initialAlias  string
		clearAlias    string
		wantClearOK   bool
		wantFinalAlias string
	}{
		{
			name:           "clearing a previously-set alias empties it",
			initialAlias:   "Proj A",
			clearAlias:     "",
			wantClearOK:    true,
			wantFinalAlias: "",
		},
	}

	for _, test := range testCases {
		t.Run(test.name, func(t *testing.T) {
			r := &Registry{}
			r.Add("/home/u/proj")
			if !r.SetAlias("/home/u/proj", test.initialAlias) {
				t.Fatal("failed to set up initial alias")
			}

			got := r.SetAlias("/home/u/proj", test.clearAlias)
			if got != test.wantClearOK {
				t.Fatalf("SetAlias clear = %v, want %v", got, test.wantClearOK)
			}

			entries := r.ListEntries()
			if len(entries) != 1 || entries[0].Path != "/home/u/proj" {
				t.Fatalf("ListEntries() = %v, want single entry for /home/u/proj", entries)
			}
			if entries[0].Alias != test.wantFinalAlias {
				t.Fatalf("alias after clear = %q, want %q", entries[0].Alias, test.wantFinalAlias)
			}
		})
	}
}

// TestRemoveUnaffectedByAlias covers behavioral example 7: removing a path
// removes it regardless of whether it has an alias, and Remove returns
// false for a path that was never registered.
func TestRemoveUnaffectedByAlias(t *testing.T) {
	testCases := []struct {
		name       string
		alias      string
		remove     string
		wantOK     bool
		wantRemain []string
	}{
		{
			name:       "removing an aliased path succeeds and drops it",
			alias:      "Proj A",
			remove:     "/home/u/proj",
			wantOK:     true,
			wantRemain: nil,
		},
		{
			name:       "removing a path that was never registered fails",
			alias:      "Proj A",
			remove:     "/never/registered",
			wantOK:     false,
			wantRemain: []string{"/home/u/proj"},
		},
	}

	for _, test := range testCases {
		t.Run(test.name, func(t *testing.T) {
			r := &Registry{}
			r.Add("/home/u/proj")
			r.SetAlias("/home/u/proj", test.alias)

			got := r.Remove(test.remove)
			if got != test.wantOK {
				t.Fatalf("Remove(%q) = %v, want %v", test.remove, got, test.wantOK)
			}

			remain := r.List()
			if len(remain) != len(test.wantRemain) {
				t.Fatalf("List() after Remove = %v, want %v", remain, test.wantRemain)
			}
			for i, p := range test.wantRemain {
				if remain[i] != p {
					t.Fatalf("List()[%d] = %q, want %q", i, remain[i], p)
				}
			}
		})
	}
}

// TestReorderPreservesAliases covers behavioral example 10: reordering via
// Reorder with the same path set in a different order preserves each
// entry's existing alias. It also covers the plan's validation contract:
// Reorder returns false (and must not mutate state) if the given paths
// don't match the currently registered set.
func TestReorderPreservesAliases(t *testing.T) {
	testCases := []struct {
		name         string
		reorderTo    []string
		wantOK       bool
		wantOrder    []string
		wantAliasAB  string // expected alias of /a/b after the call
	}{
		{
			name:        "reordering the same set in different order preserves alias",
			reorderTo:   []string{"/c/d", "/a/b"},
			wantOK:      true,
			wantOrder:   []string{"/c/d", "/a/b"},
			wantAliasAB: "Foo",
		},
		{
			name:        "reorder with a substituted path fails and leaves state untouched",
			reorderTo:   []string{"/c/d", "/x/y"},
			wantOK:      false,
			wantOrder:   []string{"/a/b", "/c/d"},
			wantAliasAB: "Foo",
		},
		{
			name:        "reorder with wrong length fails and leaves state untouched",
			reorderTo:   []string{"/a/b"},
			wantOK:      false,
			wantOrder:   []string{"/a/b", "/c/d"},
			wantAliasAB: "Foo",
		},
	}

	for _, test := range testCases {
		t.Run(test.name, func(t *testing.T) {
			r := &Registry{}
			r.Add("/a/b")
			r.Add("/c/d")
			if !r.SetAlias("/a/b", "Foo") {
				t.Fatal("failed to set up initial alias on /a/b")
			}

			got := r.Reorder(test.reorderTo)
			if got != test.wantOK {
				t.Fatalf("Reorder(%v) = %v, want %v", test.reorderTo, got, test.wantOK)
			}

			order := r.List()
			if len(order) != len(test.wantOrder) {
				t.Fatalf("List() after Reorder = %v, want %v", order, test.wantOrder)
			}
			for i, p := range test.wantOrder {
				if order[i] != p {
					t.Fatalf("List()[%d] = %q, want %q", i, order[i], p)
				}
			}

			entries := r.ListEntries()
			var gotAlias string
			for _, e := range entries {
				if e.Path == "/a/b" {
					gotAlias = e.Alias
				}
			}
			if gotAlias != test.wantAliasAB {
				t.Fatalf("/a/b alias after Reorder = %q, want %q", gotAlias, test.wantAliasAB)
			}
		})
	}
}

// TestListEntriesShape covers the plan's contract that ListEntries returns
// {Path, Alias} pairs reflecting each path's current alias state (or empty
// string if never aliased), independent of List()'s bare-path shape.
func TestListEntriesShape(t *testing.T) {
	testCases := []struct {
		name    string
		aliases map[string]string // path -> alias to set (only for paths present)
		want    []Entry
	}{
		{
			name:    "no aliases set yields empty-alias entries",
			aliases: map[string]string{},
			want: []Entry{
				{Path: "/a/b", Alias: ""},
				{Path: "/c/d", Alias: ""},
			},
		},
		{
			name:    "one aliased path reflected, other left empty",
			aliases: map[string]string{"/a/b": "Foo"},
			want: []Entry{
				{Path: "/a/b", Alias: "Foo"},
				{Path: "/c/d", Alias: ""},
			},
		},
	}

	for _, test := range testCases {
		t.Run(test.name, func(t *testing.T) {
			r := &Registry{}
			r.Add("/a/b")
			r.Add("/c/d")
			for path, alias := range test.aliases {
				r.SetAlias(path, alias)
			}

			got := r.ListEntries()
			if len(got) != len(test.want) {
				t.Fatalf("ListEntries() = %v, want %v", got, test.want)
			}
			for i, want := range test.want {
				if got[i] != want {
					t.Fatalf("ListEntries()[%d] = %+v, want %+v", i, got[i], want)
				}
			}
		})
	}
}

// TestLoadLegacyMigration covers behavioral example 9: load() migrates a
// legacy plain-string-array directories.json into []Entry in memory,
// without touching the on-disk bytes until the next mutating save().
func TestLoadLegacyMigration(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "directories.json")

	legacy := `["/a/b","/c/d"]`
	if err := os.WriteFile(file, []byte(legacy), 0o644); err != nil {
		t.Fatalf("failed to write legacy fixture: %v", err)
	}

	r := &Registry{file: file}
	if err := r.load(); err != nil {
		t.Fatalf("load() = %v, want nil", err)
	}

	want := []Entry{
		{Path: "/a/b", Alias: ""},
		{Path: "/c/d", Alias: ""},
	}
	got := r.ListEntries()
	if len(got) != len(want) {
		t.Fatalf("ListEntries() after legacy load = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ListEntries()[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}

	// Migration is lazy: the file on disk must be untouched immediately
	// after load(), still in the legacy plain-string-array shape.
	onDisk, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("failed to read back file: %v", err)
	}
	if string(onDisk) != legacy {
		t.Fatalf("file on disk after load() = %q, want unchanged legacy bytes %q", onDisk, legacy)
	}

	// A subsequent mutation triggers save(), which persists the migrated
	// []Entry object-array shape.
	if !r.SetAlias("/a/b", "Foo") {
		t.Fatal("SetAlias(\"/a/b\", \"Foo\") = false, want true")
	}

	migrated, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("failed to read back file after save: %v", err)
	}

	var entries []Entry
	if err := json.Unmarshal(migrated, &entries); err != nil {
		t.Fatalf("file on disk after save() is not valid []Entry JSON: %v (content: %s)", err, migrated)
	}
	wantMigrated := []Entry{
		{Path: "/a/b", Alias: "Foo"},
		{Path: "/c/d", Alias: ""},
	}
	if len(entries) != len(wantMigrated) {
		t.Fatalf("on-disk entries after save() = %v, want %v", entries, wantMigrated)
	}
	for i := range wantMigrated {
		if entries[i] != wantMigrated[i] {
			t.Fatalf("on-disk entries[%d] after save() = %+v, want %+v", i, entries[i], wantMigrated[i])
		}
	}
}

// TestLoadInvalidJSON covers load()'s error path: file contents that are
// neither a valid []Entry nor a valid []string must return a non-nil error.
func TestLoadInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "directories.json")

	if err := os.WriteFile(file, []byte(`not valid json {{{`), 0o644); err != nil {
		t.Fatalf("failed to write invalid fixture: %v", err)
	}

	r := &Registry{file: file}
	if err := r.load(); err == nil {
		t.Fatal("load() with invalid JSON = nil error, want non-nil")
	}
}

// TestLoadEmptyFilePath covers load()'s early-return contract: an empty
// file path (persistPath() failure case) must not error.
func TestLoadEmptyFilePath(t *testing.T) {
	r := &Registry{file: ""}
	if err := r.load(); err != nil {
		t.Fatalf("load() with empty file path = %v, want nil", err)
	}
	if len(r.dirs) != 0 {
		t.Fatalf("dirs after load() with empty file path = %v, want empty", r.dirs)
	}
}

// TestListEntriesDefensiveCopy covers ListEntries()'s contract that the
// returned slice is a copy: mutating it must not affect the registry's
// internal state or a subsequent ListEntries() call.
func TestListEntriesDefensiveCopy(t *testing.T) {
	r := &Registry{}
	r.Add("/a/b")
	r.SetAlias("/a/b", "Foo")

	entries := r.ListEntries()
	entries[0].Alias = "Mutated"

	again := r.ListEntries()
	if len(again) != 1 || again[0].Alias != "Foo" {
		t.Fatalf("ListEntries() after external mutation = %+v, want alias unaffected (\"Foo\")", again)
	}
}

// TestListDefensiveCopy covers List()'s contract: the returned slice is a
// copy of paths only (no alias data leaks through), and mutating it does
// not affect a subsequent List() call.
func TestListDefensiveCopy(t *testing.T) {
	r := &Registry{}
	r.Add("/a/b")
	r.SetAlias("/a/b", "Foo")

	paths := r.List()
	if len(paths) != 1 || paths[0] != "/a/b" {
		t.Fatalf("List() = %v, want [\"/a/b\"] (paths only, no alias)", paths)
	}

	paths[0] = "/mutated"

	again := r.List()
	if len(again) != 1 || again[0] != "/a/b" {
		t.Fatalf("List() after external mutation = %v, want unaffected [\"/a/b\"]", again)
	}
}
