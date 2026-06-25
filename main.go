package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/gorilla/mux"

	"github.com/malvex/vibediff/internal/git"
	"github.com/malvex/vibediff/internal/handlers"
	"github.com/malvex/vibediff/internal/mcp"
	"github.com/malvex/vibediff/internal/registry"
	"github.com/malvex/vibediff/internal/review"
	"github.com/malvex/vibediff/internal/watcher"
)

// Version information
var (
	Version   = "dev"
	CommitSHA = "unknown"
	BuildDate = "unknown"
)

//go:embed all:web/dist
var webFiles embed.FS

// openBrowser opens the default browser to the specified URL
func openBrowser(url string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "cmd"
		args = []string{"/c", "start", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default: // "linux", "freebsd", "openbsd", "netbsd"
		cmd = "xdg-open"
		args = []string{url}
	}

	return exec.Command(cmd, args...).Start()
}

func main() {
	// Parse command line flags
	var (
		host    = flag.String("host", "localhost", "Host to bind the server to")
		port    = flag.Int("port", 8888, "Port to bind the server to")
		debug   = flag.Bool("debug", false, "Enable debug logging")
		version = flag.Bool("version", false, "Show version information")
		noOpen  = flag.Bool("no-open", false, "Disable automatic browser opening")
		dev     = flag.Bool("dev", false, "Serve web assets from web/dist/ on disk (for watch/dev mode)")
	)
	flag.Parse()

	// Handle version flag
	if *version {
		fmt.Printf("VibeDiff version %s\n", Version)
		fmt.Printf("Commit: %s\n", CommitSHA)
		fmt.Printf("Built: %s\n", BuildDate)
		os.Exit(0)
	}

	// Configure logging
	log.SetOutput(os.Stderr)
	if *debug {
		os.Setenv("VIBEDIFF_DEBUG", "true")
	}

	// Get diff target from positional argument
	var target string
	if flag.NArg() > 0 {
		target = flag.Arg(0)
	}

	reviewStore := review.NewStore()

	gitService := git.NewService()
	gitService.SetDiffTarget(target)

	// Load the known-directories registry (persisted across runs).
	reg := registry.New()

	// Auto-register the startup (current working) directory if it is a valid
	// VCS repo. This ensures fresh installs work out of the box without
	// requiring the user to manually add a directory.
	if startupDir, err := os.Getwd(); err == nil {
		if valErr := gitService.ValidateRepo(startupDir); valErr == nil {
			reg.Add(startupDir)
			_ = reviewStore.LoadComments(startupDir)
			backend := gitService.GetBackend(startupDir)
			if backend == git.BackendJJ {
				fmt.Fprintln(os.Stderr, "Detected jj repository")
			}
		}
	}

	// Create WebSocket hub
	wsHub := handlers.NewWSHub()
	go wsHub.Run()

	// Notify the UI whenever a comment is added — covers agent replies
	// posted through the MCP reply_to_comment tool.
	_ = reviewStore.Subscribe(func(c *review.Comment) {
		dir := ""
		if c != nil {
			dir = c.Directory
		}
		wsHub.NotifyChange("comment_changed", dir)
	})

	// Start multi-directory file watcher
	gitWatcher := watcher.NewGitWatcher(wsHub, gitService, reg)
	gitWatcher.Start()

	handler := handlers.NewHandler(gitService, reviewStore, reg)

	r := mux.NewRouter().UseEncodedPath()

	r.HandleFunc("/api/revisions", handler.GetRevisions).Methods("GET")
	r.HandleFunc("/api/diff", handler.GetDiff).Methods("GET")
	r.HandleFunc("/api/diff/{file:.+}/full", handler.GetFullFileWithDiff).Methods("GET")
	r.HandleFunc("/api/diff/{file:.+}", handler.GetFileDiff).Methods("GET")
	r.HandleFunc("/api/review/comment", handler.AddComment).Methods("POST")
	r.HandleFunc("/api/review/comments", handler.GetComments).Methods("GET")
	r.HandleFunc("/api/review/comments/open", handler.GetOpenComments).Methods("GET")
	r.HandleFunc("/api/review/comments/resolved", handler.GetResolvedComments).Methods("GET")
	r.HandleFunc("/api/review/comments/latest", handler.GetLatestComment).Methods("GET")
	r.HandleFunc("/api/review/comment/{id}", handler.UpdateComment).Methods("PATCH")
	r.HandleFunc("/api/review/comment/{id}", handler.DeleteComment).Methods("DELETE")
	r.HandleFunc("/api/review/comments", handler.ClearAllComments).Methods("DELETE")
	r.HandleFunc("/api/review/comment/{id}/resolve", handler.ResolveComment).Methods("POST")
	r.HandleFunc("/api/review/comment/{id}/reopen", handler.ReopenComment).Methods("POST")

	r.HandleFunc("/docs", handler.ServeDocsPage).Methods("GET")

	// Directory/registry endpoints.
	// NOTE: /api/directories/validate must be registered before the
	// wildcard /api/directories/{path:.+} so gorilla/mux picks the
	// more specific route first.
	r.HandleFunc("/api/directory", handler.GetDirectoryInfo).Methods("GET")
	r.HandleFunc("/api/directories", handler.ListDirectories).Methods("GET")
	r.HandleFunc("/api/directories", handler.RegisterDirectory).Methods("POST")
	r.HandleFunc("/api/directories/validate", handler.ValidateDirectory).Methods("POST")
	r.HandleFunc("/api/directories/{path:.+}", handler.RemoveDirectory).Methods("DELETE")

	// WebSocket endpoint for live updates
	r.HandleFunc("/api/ws", handler.HandleWebSocket(wsHub)).Methods("GET")

	// Embedded MCP server.
	mcpServer := mcp.New(reviewStore, gitService, mcp.NewGitHunkProvider(gitService))
	r.PathPrefix("/mcp").Handler(mcpServer.Handler())

	// Serve static assets from React build
	var webFS fs.FS
	if *dev {
		log.Println("Dev mode: serving web assets from web/dist/ on disk")
		webFS = os.DirFS("web/dist")
	} else {
		var err error
		webFS, err = fs.Sub(webFiles, "web/dist")
		if err != nil {
			log.Fatal("Failed to create sub filesystem:", err)
		}
	}
	r.PathPrefix("/assets/").Handler(http.FileServer(http.FS(webFS)))
	r.PathPrefix("/themes/").Handler(http.FileServer(http.FS(webFS)))

	// API routes for file content
	r.HandleFunc("/api/file", handler.GetFileContent).Methods("GET")

	// Catch-all route for React app (must be last)
	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var indexHTML []byte
		var err error
		if *dev {
			indexHTML, err = os.ReadFile("web/dist/index.html")
		} else {
			indexHTML, err = webFiles.ReadFile("web/dist/index.html")
		}
		if err != nil {
			http.Error(w, "Application not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if _, err := w.Write(indexHTML); err != nil {
			log.Printf("Failed to write response: %v", err)
		}
	})

	addr := fmt.Sprintf("%s:%d", *host, *port)
	srv := &http.Server{
		Addr:        addr,
		Handler:     r,
		ReadTimeout: 15 * time.Second,
		// WriteTimeout is intentionally unset — MCP long-polls can hold
		// connections open for up to 10 minutes.
	}

	// Determine if we should open the browser
	shouldOpen := true
	if *noOpen {
		shouldOpen = false
	} else if os.Getenv("VIBEDIFF_NO_OPEN") != "" {
		shouldOpen = false
	}

	go func() {
		fmt.Fprintf(os.Stderr, "Starting VibeDiff server on http://%s\n", addr)

		if shouldOpen {
			time.Sleep(100 * time.Millisecond)
			url := fmt.Sprintf("http://%s", addr)
			if err := openBrowser(url); err != nil {
				log.Printf("Failed to open browser: %v", err)
			} else {
				fmt.Fprintf(os.Stderr, "Opening browser at %s\n", url)
			}
		}

		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	fmt.Fprintln(os.Stderr, "\nShutting down server...")

	gitWatcher.Stop()
	wsHub.Shutdown()

	time.Sleep(100 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}
}
