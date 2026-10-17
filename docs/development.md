# Development

## Prerequisites

- Go 1.25+
- Node.js 18+ and npm
- [Task](https://taskfile.dev) (optional)

## Running locally

```bash
task dev          # backend + frontend dev server (http://localhost:5173)
task serve        # backend only, no browser, reloads on Go changes
task web-dev      # frontend only, with hot reload
```

Or by hand: `go run main.go` in one terminal and `cd web && npm run dev` in another.

## Tasks

```bash
task            # list all tasks
task build      # production binary with embedded assets
task build-web  # React app only
task install    # install globally
task test       # Go tests
task lint       # golangci-lint
task fmt        # go fmt
task clean      # remove build artifacts
task release    # binaries for all platforms
```

Frontend: `cd web && npm test`, `npm run lint`.

## Tech stack

- Backend: Go with Gorilla Mux and WebSockets
- Frontend: React 19, TypeScript, Tailwind CSS v4, PrismJS
- Build: Vite, Task, embedded with `go:embed`
- Quality: ESLint, golangci-lint, pre-commit

## Architecture in brief

`main.go` starts an HTTP server, a WebSocket hub, and a VCS-aware watcher that polls repo status once a second. When the working copy changes, the hub notifies the browser, which refetches the diff over REST. Comments live in an in-memory store persisted to `~/.config/vibediff/comments/`. VCS operations shell out to `git` or `jj` (`internal/git`).
