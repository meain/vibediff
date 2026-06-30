package git

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

type Service struct {
	diffTarget   string
	backendCache sync.Map // string(dir) -> VCSBackend
}

func NewService() *Service {
	return &Service{}
}

// SetDiffTarget sets the target for diff (e.g., "main", "HEAD~1", commit hash)
func (s *Service) SetDiffTarget(target string) {
	s.diffTarget = target
}

// GetBackend returns the VCS backend for the given directory (cached).
func (s *Service) GetBackend(dir string) VCSBackend {
	return s.getBackend(dir)
}

func (s *Service) getBackend(dir string) VCSBackend {
	if v, ok := s.backendCache.Load(dir); ok {
		return v.(VCSBackend)
	}
	backend := s.detectBackend(dir)
	s.backendCache.Store(dir, backend)
	return backend
}

func (s *Service) detectBackend(dir string) VCSBackend {
	if s.isJJRepo(dir) {
		return BackendJJ
	}
	return BackendGit
}

func (s *Service) isJJRepo(dir string) bool {
	var cmd *exec.Cmd
	if dir != "" {
		cmd = exec.Command("jj", "root", "-R", dir)
	} else {
		cmd = exec.Command("jj", "root")
	}
	cmd.Stderr = nil
	return cmd.Run() == nil
}

// GetDiff retrieves the diff with optional context lines (default: 3)
func (s *Service) GetDiff(dir string, diffType DiffType, contextLines ...int) (*DiffResult, error) {
	context := 3
	if len(contextLines) > 0 {
		context = contextLines[0]
	}

	if s.getBackend(dir) == BackendJJ {
		return s.getJJDiff(dir, diffType, context)
	}
	return s.getGitDiff(dir, diffType, context)
}

func (s *Service) getGitDiff(dir string, diffType DiffType, context int) (*DiffResult, error) {
	var args []string

	if s.diffTarget != "" {
		args = []string{"diff", s.diffTarget, "--no-color", "--no-ext-diff"}
	} else {
		switch diffType {
		case DiffTypeStaged:
			args = []string{"diff", "--cached", "--no-color", "--no-ext-diff"}
		case DiffTypeUnstaged:
			args = []string{"diff", "--no-color", "--no-ext-diff"}
		default:
			args = []string{"diff", "HEAD", "--no-color", "--no-ext-diff"}
		}
	}

	if context >= 0 {
		args = append(args, fmt.Sprintf("-U%d", context))
	}

	output, err := s.runGitCommand(dir, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get diff: %w", err)
	}

	files, err := s.parseDiff(output)
	if err != nil {
		return nil, fmt.Errorf("failed to parse diff: %w", err)
	}

	// Get untracked files and add them to the diff
	if diffType == DiffTypeUnstaged || diffType == DiffTypeAll {
		untrackedFiles, err := s.getUntrackedFiles(dir)
		if err == nil && len(untrackedFiles) > 0 {
			for _, fp := range untrackedFiles {
				fileDiff, err := s.getUntrackedFileDiff(dir, fp, context)
				if err == nil && fileDiff != nil {
					files = append(files, *fileDiff)
				}
			}
		}
	}

	return &DiffResult{
		Files: s.markGeneratedFiles(dir, files),
		Type:  diffType,
	}, nil
}

func (s *Service) getJJDiff(dir string, diffType DiffType, context int) (*DiffResult, error) {
	args := []string{"diff", "--git"}

	if s.diffTarget != "" {
		args = append(args, "--from", s.diffTarget)
	}

	if context >= 0 {
		args = append(args, fmt.Sprintf("--context=%d", context))
	}

	output, err := s.runJJCommand(dir, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get jj diff: %w", err)
	}

	files, err := s.parseDiff(output)
	if err != nil {
		return nil, fmt.Errorf("failed to parse diff: %w", err)
	}

	return &DiffResult{
		Files: s.markGeneratedFiles(dir, files),
		Type:  diffType,
	}, nil
}

func (s *Service) GetStatus(dir string) ([]string, error) {
	if s.getBackend(dir) == BackendJJ {
		return s.getJJStatus(dir)
	}
	return s.getGitStatus(dir)
}

func (s *Service) getGitStatus(dir string) ([]string, error) {
	output, err := s.runGitCommand(dir, "status", "--porcelain")
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(output), "\n")
	var files []string
	for _, line := range lines {
		if len(line) > 3 {
			files = append(files, strings.TrimSpace(line[3:]))
		}
	}

	return files, nil
}

func (s *Service) getJJStatus(dir string) ([]string, error) {
	output, err := s.runJJCommand(dir, "status")
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(output), "\n")
	var files []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if len(line) > 2 && (line[0] == 'M' || line[0] == 'A' || line[0] == 'D' || line[0] == 'R' || line[0] == 'C') && line[1] == ' ' {
			files = append(files, line[2:])
		}
	}

	return files, nil
}

func (s *Service) runGitCommand(dir string, args ...string) (string, error) {
	var cmdArgs []string
	if dir != "" {
		cmdArgs = append([]string{"-C", dir}, args...)
	} else {
		cmdArgs = args
	}

	cmd := exec.Command("git", cmdArgs...)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("git command failed: %s", stderr.String())
	}

	return out.String(), nil
}

func (s *Service) runJJCommand(dir string, args ...string) (string, error) {
	var cmdArgs []string
	if dir != "" {
		cmdArgs = append([]string{"-R", dir}, args...)
	} else {
		cmdArgs = args
	}

	// Use --no-pager and --color=never for consistent output
	cmdArgs = append([]string{"--no-pager", "--color=never"}, cmdArgs...)

	cmd := exec.Command("jj", cmdArgs...)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("jj command failed: %s", stderr.String())
	}

	return out.String(), nil
}

// markGeneratedFiles tags FileDiff entries whose paths are marked
// linguist-generated=true in .gitattributes. It tries git check-attr first
// (works for plain git repos) and falls back to a simple manual parse of
// .gitattributes so jj repos are also covered.
func (s *Service) markGeneratedFiles(dir string, files []FileDiff) []FileDiff {
	if len(files) == 0 {
		return files
	}

	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.Path
	}

	generated := s.getGeneratedSet(dir, paths)
	for i := range files {
		if generated[files[i].Path] {
			files[i].IsGenerated = true
		}
	}
	return files
}

// getGeneratedSet returns which of the given paths have linguist-generated=true.
func (s *Service) getGeneratedSet(dir string, paths []string) map[string]bool {
	result := make(map[string]bool)
	if len(paths) == 0 {
		return result
	}

	// Try git check-attr first (works for git repos and jj repos with git backend).
	args := append([]string{"check-attr", "linguist-generated", "--"}, paths...)
	var cmdArgs []string
	if dir != "" {
		cmdArgs = append([]string{"-C", dir}, args...)
	} else {
		cmdArgs = args
	}
	cmd := exec.Command("git", cmdArgs...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = nil
	if err := cmd.Run(); err == nil {
		// Output: "filename: linguist-generated: set|true|unspecified"
		for _, line := range strings.Split(out.String(), "\n") {
			parts := strings.SplitN(line, ": ", 3)
			if len(parts) == 3 {
				val := strings.TrimSpace(parts[2])
				if val == "set" || val == "true" {
					result[parts[0]] = true
				}
			}
		}
		return result
	}

	// Fallback: parse .gitattributes manually (for jj repos without git binary access).
	attrPath := ".gitattributes"
	if dir != "" {
		attrPath = filepath.Join(dir, ".gitattributes")
	}
	content, err := os.ReadFile(attrPath)
	if err != nil {
		return result
	}

	type rule struct{ pattern string }
	var rules []rule
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pattern := fields[0]
		for _, attr := range fields[1:] {
			if attr == "linguist-generated" || attr == "linguist-generated=true" {
				rules = append(rules, rule{pattern: pattern})
				break
			}
		}
	}

	for _, path := range paths {
		for _, r := range rules {
			if matchGitAttrPattern(r.pattern, path) {
				result[path] = true
				break
			}
		}
	}
	return result
}

// matchGitAttrPattern matches a gitattributes glob pattern against a file path.
// It handles ** as "zero or more path components", matching gitattributes semantics.
func matchGitAttrPattern(pattern, path string) bool {
	if !strings.Contains(pattern, "**") {
		// Exact path match.
		if m, _ := filepath.Match(pattern, path); m {
			return true
		}
		// Basename match for patterns without a separator.
		if !strings.Contains(pattern, "/") {
			if m, _ := filepath.Match(pattern, filepath.Base(path)); m {
				return true
			}
		}
		return false
	}

	// Split on the first **.
	idx := strings.Index(pattern, "**")
	prefix := pattern[:idx]
	rest := strings.TrimPrefix(pattern[idx+2:], "/")

	// The path must start with the literal prefix before **.
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	remaining := path[len(prefix):]

	if rest == "" || rest == "*" {
		// ** or **/* — match anything under prefix.
		return true
	}

	// Try matching rest recursively against every suffix of remaining.
	parts := strings.Split(remaining, "/")
	for i := range parts {
		subpath := strings.Join(parts[i:], "/")
		if matchGitAttrPattern(rest, subpath) {
			return true
		}
	}
	return false
}

func (s *Service) parseDiff(diffOutput string) ([]FileDiff, error) {
	if diffOutput == "" {
		return []FileDiff{}, nil
	}

	parser := newDiffParser(diffOutput)
	return parser.parse()
}

func (s *Service) GetFileContent(dir string, filePath string) (string, error) {
	if s.getBackend(dir) == BackendJJ {
		return s.getJJFileContent(dir, filePath)
	}
	return s.getGitFileContent(dir, filePath)
}

func (s *Service) getGitFileContent(dir string, filePath string) (string, error) {
	content, err := s.runGitCommand(dir, "show", fmt.Sprintf("HEAD:%s", filePath))
	if err != nil {
		// If not in HEAD, try to read from filesystem
		fullPath := filePath
		if dir != "" {
			fullPath = dir + "/" + filePath
		}
		content, err := os.ReadFile(fullPath)
		if err != nil {
			return "", fmt.Errorf("failed to read file: %w", err)
		}
		return string(content), nil
	}
	return content, nil
}

func (s *Service) getJJFileContent(dir string, filePath string) (string, error) {
	// Show file at parent of working copy
	content, err := s.runJJCommand(dir, "file", "show", "-r", "@-", filePath)
	if err != nil {
		// If not in parent, try reading from filesystem
		fullPath := filePath
		if dir != "" {
			fullPath = dir + "/" + filePath
		}
		content, err := os.ReadFile(fullPath)
		if err != nil {
			return "", fmt.Errorf("failed to read file: %w", err)
		}
		return string(content), nil
	}
	return content, nil
}

// GetFileDiff retrieves diff for a specific file with optional context lines
func (s *Service) GetFileDiff(dir string, filename string, diffType DiffType, contextLines ...int) (*FileDiff, error) {
	context := 3
	if len(contextLines) > 0 {
		context = contextLines[0]
	}

	if s.getBackend(dir) == BackendGit {
		// Check if it's an untracked file (git only)
		untrackedFiles, err := s.getUntrackedFiles(dir)
		if err == nil {
			for _, untracked := range untrackedFiles {
				if untracked == filename {
					return s.getUntrackedFileDiff(dir, filename, context)
				}
			}
		}
	}

	// Get from regular diff
	diff, err := s.GetDiff(dir, diffType, contextLines...)
	if err != nil {
		return nil, err
	}

	for _, file := range diff.Files {
		if file.Path == filename {
			return &file, nil
		}
	}

	return nil, fmt.Errorf("file not found in diff: %s", filename)
}

// GetFileDiffWithFullContext is a convenience method for getting full file context
func (s *Service) GetFileDiffWithFullContext(dir string, filename string, diffType DiffType) (*FileDiff, error) {
	return s.GetFileDiff(dir, filename, diffType, 999999)
}

// GetRevisionFileDiffWithFullContext returns a file diff with full context for a specific revision
func (s *Service) GetRevisionFileDiffWithFullContext(dir string, filename string, revisionID string) (*FileDiff, error) {
	diff, err := s.GetRevisionDiff(dir, revisionID, 999999)
	if err != nil {
		return nil, err
	}
	for _, file := range diff.Files {
		if file.Path == filename {
			return &file, nil
		}
	}
	return nil, fmt.Errorf("file not found in revision diff: %s", filename)
}

// getUntrackedFiles returns list of untracked files from git status
func (s *Service) getUntrackedFiles(dir string) ([]string, error) {
	output, err := s.runGitCommand(dir, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil, err
	}

	if output == "" {
		return []string{}, nil
	}

	lines := strings.Split(strings.TrimSpace(output), "\n")
	var files []string
	for _, line := range lines {
		if line != "" {
			files = append(files, line)
		}
	}

	return files, nil
}

// getUntrackedFileDiff creates a diff for an untracked file
func (s *Service) getUntrackedFileDiff(dir string, filePath string, contextLines int) (*FileDiff, error) {
	fullPath := filePath
	if dir != "" {
		fullPath = dir + "/" + filePath
	}
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read untracked file %s: %w", filePath, err)
	}

	lines := strings.Split(string(content), "\n")

	var diffLines []Line
	for i, line := range lines {
		lineNum := i + 1
		diffLines = append(diffLines, Line{
			Type:      LineTypeAdded,
			NewNumber: &lineNum,
			Content:   line,
		})
	}

	return &FileDiff{
		Path:      filePath,
		Status:    FileStatusAdded,
		Additions: len(lines),
		Deletions: 0,
		IsBinary:  false,
		Hunks: []Hunk{
			{
				OldStart: 0,
				OldLines: 0,
				NewStart: 1,
				NewLines: len(lines),
				Header:   fmt.Sprintf("@@ -0,0 +1,%d @@", len(lines)),
				Lines:    diffLines,
			},
		},
	}, nil
}

// GetRevisions returns recent revisions/commits
func (s *Service) GetRevisions(dir string, limit int) ([]Revision, error) {
	if limit <= 0 {
		limit = 50
	}
	if s.getBackend(dir) == BackendJJ {
		return s.getJJRevisions(dir, limit)
	}
	return s.getGitRevisions(dir, limit)
}

func (s *Service) getGitRevisions(dir string, limit int) ([]Revision, error) {
	// Use US (0x1F) as a field separator instead of NUL
	output, err := s.runGitCommand(dir, "log", "--format=format:%H\x1f%h\x1f%s\x1f%an\x1f%aI\x1f%D\x1f%P", fmt.Sprintf("-n%d", limit))
	if err != nil {
		return nil, fmt.Errorf("failed to get git log: %w", err)
	}

	if output == "" {
		return []Revision{}, nil
	}

	lines := strings.Split(strings.TrimSpace(output), "\n")
	var revisions []Revision
	for _, line := range lines {
		parts := strings.SplitN(line, "\x1f", 7)
		if len(parts) < 5 {
			continue
		}
		rev := Revision{
			ID:          parts[0],
			ShortID:     parts[1],
			Description: parts[2],
			Author:      parts[3],
			Timestamp:   parts[4],
		}
		if len(parts) >= 6 && parts[5] != "" {
			rev.Bookmarks = parseGitDecorations(parts[5])
		}
		if len(parts) >= 7 && parts[6] != "" {
			rev.Parents = strings.Fields(parts[6])
		}
		revisions = append(revisions, rev)
	}

	return revisions, nil
}

// parseGitDecorations extracts branch/tag names from git %D decoration string.
func parseGitDecorations(decorate string) []string {
	var refs []string
	for _, part := range strings.Split(decorate, ",") {
		part = strings.TrimSpace(part)
		if part == "" || part == "HEAD" {
			continue
		}
		if strings.HasPrefix(part, "HEAD -> ") {
			refs = append(refs, strings.TrimPrefix(part, "HEAD -> "))
			continue
		}
		refs = append(refs, part)
	}
	return refs
}

func (s *Service) getJJRevisions(dir string, limit int) ([]Revision, error) {
	template := `change_id ++ "\x00" ++ change_id.shortest(8) ++ "\x00" ++ description.first_line() ++ "\x00" ++ author.name() ++ "\x00" ++ author.timestamp() ++ "\x00" ++ bookmarks.join("|") ++ "\x00" ++ if(parents.len() > 0, parents.first().change_id(), "") ++ if(parents.len() > 1, "|" ++ parents.last().change_id(), "") ++ "\n"`
	output, err := s.runJJCommand(dir, "log", "--no-graph", "-r", fmt.Sprintf("ancestors(@, %d)", limit), "-T", template)
	if err != nil {
		return nil, fmt.Errorf("failed to get jj log: %w", err)
	}

	if output == "" {
		return []Revision{}, nil
	}

	lines := strings.Split(strings.TrimSpace(output), "\n")
	var revisions []Revision
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\x00", 7)
		if len(parts) < 5 {
			continue
		}
		rev := Revision{
			ID:          parts[0],
			ShortID:     parts[1],
			Description: parts[2],
			Author:      parts[3],
			Timestamp:   parts[4],
		}
		if len(parts) >= 6 && parts[5] != "" {
			rev.Bookmarks = parseJJBookmarks(parts[5])
		}
		if len(parts) >= 7 && parts[6] != "" {
			rev.Parents = splitAndFilter(parts[6], "|")
		}
		revisions = append(revisions, rev)
	}

	// In jj, the first revision (@ / working copy) is the working copy
	if len(revisions) > 0 {
		revisions[0].IsWorkingCopy = true
	}

	return revisions, nil
}

// parseJJBookmarks splits a "|"-separated bookmark string and strips the "*" suffix.
func parseJJBookmarks(raw string) []string {
	var out []string
	for _, b := range strings.Split(raw, "|") {
		b = strings.TrimSpace(b)
		b = strings.TrimSuffix(b, "*")
		if b != "" {
			out = append(out, b)
		}
	}
	return out
}

// splitAndFilter splits a string by sep and removes empty parts.
func splitAndFilter(s, sep string) []string {
	var out []string
	for _, p := range strings.Split(s, sep) {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// GetRevisionDiff returns the diff for a specific revision
func (s *Service) GetRevisionDiff(dir string, revisionID string, contextLines ...int) (*DiffResult, error) {
	context := 3
	if len(contextLines) > 0 {
		context = contextLines[0]
	}

	if s.getBackend(dir) == BackendJJ {
		return s.getJJRevisionDiff(dir, revisionID, context)
	}
	return s.getGitRevisionDiff(dir, revisionID, context)
}

func (s *Service) getGitRevisionDiff(dir string, revisionID string, context int) (*DiffResult, error) {
	args := []string{"diff", revisionID + "~1", revisionID, "--no-color", "--no-ext-diff"}
	if context >= 0 {
		args = append(args, fmt.Sprintf("-U%d", context))
	}

	output, err := s.runGitCommand(dir, args...)
	if err != nil {
		// Fallback for initial commit (no parent)
		args = []string{"diff", "--no-color", "--no-ext-diff", fmt.Sprintf("-U%d", context), "4b825dc642cb6eb9a060e54bf899d69f82cf7256", revisionID}
		output, err = s.runGitCommand(dir, args...)
		if err != nil {
			return nil, fmt.Errorf("failed to get revision diff: %w", err)
		}
	}

	files, err := s.parseDiff(output)
	if err != nil {
		return nil, fmt.Errorf("failed to parse diff: %w", err)
	}

	return &DiffResult{
		Files: s.markGeneratedFiles(dir, files),
		Type:  DiffTypeAll,
	}, nil
}

func (s *Service) getJJRevisionDiff(dir string, revisionID string, context int) (*DiffResult, error) {
	args := []string{"diff", "--git", "-r", revisionID}
	if context >= 0 {
		args = append(args, fmt.Sprintf("--context=%d", context))
	}

	output, err := s.runJJCommand(dir, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get jj revision diff: %w", err)
	}

	files, err := s.parseDiff(output)
	if err != nil {
		return nil, fmt.Errorf("failed to parse diff: %w", err)
	}

	return &DiffResult{
		Files: s.markGeneratedFiles(dir, files),
		Type:  DiffTypeAll,
	}, nil
}

// ValidateRepo checks if the directory is a valid git or jj repository
func (s *Service) ValidateRepo(dir string) error {
	// Check jj first
	cmd := exec.Command("jj", "root", "-R", dir)
	cmd.Stderr = nil
	if cmd.Run() == nil {
		return nil
	}

	// Fall back to git
	cmd = exec.Command("git", "-C", dir, "rev-parse", "--git-dir")
	cmd.Stderr = nil
	if cmd.Run() == nil {
		return nil
	}

	return fmt.Errorf("not a git or jj repository: %s", dir)
}

// ValidateGitRepo checks if the directory is a valid repository (git or jj)
func (s *Service) ValidateGitRepo(dir string) error {
	return s.ValidateRepo(dir)
}

// FileDiffText returns the raw unified-diff text for a single file at the
// requested unchanged-context width.
func (s *Service) FileDiffText(dir string, file, revision string, contextLines int) (string, error) {
	if s.getBackend(dir) == BackendJJ {
		args := []string{"diff", "--git", fmt.Sprintf("--context=%d", contextLines)}
		if revision != "" {
			args = append(args, "-r", revision)
		}
		args = append(args, file)
		out, err := s.runJJCommand(dir, args...)
		if err != nil {
			return "", fmt.Errorf("file diff for %s@%s: %w", file, revision, err)
		}
		return out, nil
	}

	args := []string{"diff", fmt.Sprintf("-U%d", contextLines), "--no-color", "--no-ext-diff"}
	if revision != "" {
		args = append(args, revision+"~1", revision)
	}
	args = append(args, "--", file)
	out, err := s.runGitCommand(dir, args...)
	if err != nil {
		return "", fmt.Errorf("file diff for %s@%s: %w", file, revision, err)
	}
	return out, nil
}

// FileContentAtCommit returns the file's content at the given commit SHA.
func (s *Service) FileContentAtCommit(dir string, commit, file string) (string, error) {
	if commit == "" {
		return "", fmt.Errorf("missing commit")
	}
	if s.getBackend(dir) == BackendJJ {
		out, err := s.runJJCommand(dir, "file", "show", "-r", commit, file)
		if err != nil {
			return "", fmt.Errorf("jj file show %s@%s: %w", file, commit, err)
		}
		return out, nil
	}
	out, err := s.runGitCommand(dir, "show", fmt.Sprintf("%s:%s", commit, file))
	if err != nil {
		return "", fmt.Errorf("git show %s:%s: %w", commit, file, err)
	}
	return out, nil
}

// ResolveCommit returns the underlying commit SHA for a revision identifier.
func (s *Service) ResolveCommit(dir string, revisionID string) (string, error) {
	if s.getBackend(dir) == BackendJJ {
		rev := revisionID
		if rev == "" {
			rev = "@"
		}
		out, err := s.runJJCommand(dir, "log", "--no-graph", "-r", rev, "-T", "commit_id", "--limit", "1")
		if err != nil {
			return "", fmt.Errorf("resolving jj commit for %q: %w", revisionID, err)
		}
		return strings.TrimSpace(out), nil
	}

	rev := revisionID
	if rev == "" {
		rev = "HEAD"
	}
	out, err := s.runGitCommand(dir, "rev-parse", rev)
	if err != nil {
		return "", fmt.Errorf("resolving git commit for %q: %w", revisionID, err)
	}
	return strings.TrimSpace(out), nil
}

// StatusRaw returns raw status output for change detection (used by watcher)
func (s *Service) StatusRaw(dir string) (string, error) {
	if s.getBackend(dir) == BackendJJ {
		return s.runJJCommand(dir, "status")
	}
	return s.runGitCommand(dir, "status", "--porcelain")
}
