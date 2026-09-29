package git

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestRunCommandTimeout(t *testing.T) {
	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("sleep not available")
	}
	orig := commandTimeout
	commandTimeout = 100 * time.Millisecond
	t.Cleanup(func() { commandTimeout = orig })

	start := time.Now()
	_, err := runCommand(context.Background(), "sleep", "10")
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected DeadlineExceeded, got %v", err)
	}
	if !strings.Contains(err.Error(), "sleep 10") {
		t.Fatalf("error should include command line, got %q", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("timeout not enforced, took %s", elapsed)
	}
}

func TestRunCommandCanceledContext(t *testing.T) {
	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("sleep not available")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := runCommand(ctx, "sleep", "10")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected Canceled, got %v", err)
	}
}

func TestRunCommandErrorIncludesArgsAndStderr(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	_, err := runCommand(context.Background(), "git", "-C", t.TempDir(), "rev-parse", "--git-dir")
	if err == nil {
		t.Fatal("expected error outside a repository")
	}
	msg := err.Error()
	if !strings.Contains(msg, "git -C ") || !strings.Contains(msg, "rev-parse --git-dir") {
		t.Fatalf("error should include args, got %q", msg)
	}
	if !strings.Contains(strings.ToLower(msg), "not a git repository") {
		t.Fatalf("error should include stderr, got %q", msg)
	}
}

func TestRunCommandSuccess(t *testing.T) {
	if _, err := exec.LookPath("echo"); err != nil {
		t.Skip("echo not available")
	}
	out, err := runCommand(context.Background(), "echo", "hi")
	if err != nil {
		t.Fatal(err)
	}
	if out != "hi\n" {
		t.Fatalf("got %q", out)
	}
}
