package handlers

import (
	"fmt"
	"net/http"
)

// ServeDocsPage serves the API reference as plain Markdown.
func (h *Handler) ServeDocsPage(w http.ResponseWriter, r *http.Request) {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	base := fmt.Sprintf("%s://%s", scheme, r.Host)
	dir := h.gitService.GetWorkingDir()
	backend := string(h.gitService.GetBackend())

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	fmt.Fprintf(w, docsMarkdown, base, dir, backend, base, base, base, base, base, base, base, base, base, base, base, base, base, base, base, base, base, base)
}

var docsMarkdown = `# VibeDiff API Reference

## This instance

| Property        | Value               |
|-----------------|---------------------|
| Base URL        | %s                  |
| Project         | %s                  |
| VCS backend     | %s                  |
| UI              | %s/                 |
| MCP endpoint    | %s/mcp              |

---

## Discovery & startup

Each VibeDiff instance is a single binary serving one repository.
Default port is **8888**; pass ` + "`-port N`" + ` to change it.

` + "```" + `sh
vibediff                  # serve current directory on :8888
vibediff -port 9000       # custom port
vibediff main             # diff against a branch/commit instead of working copy
` + "```" + `

Find running instances:

` + "```" + `sh
lsof -iTCP -sTCP:LISTEN | grep vibediff
# or
ps aux | grep vibediff
` + "```" + `

Confirm which project an instance is reviewing:

` + "```" + `sh
curl %s/api/directory
# {"directory":"/path/to/repo","backend":"jj"}
` + "```" + `

### Switching projects at runtime

Comments for the current project are saved before loading the new one:

` + "```" + `sh
curl -X POST %s/api/directory \
  -H 'Content-Type: application/json' \
  -d '{"directory":"/other/repo"}'
` + "```" + `

### Comment persistence

Comments survive restarts and project switches, stored at:

` + "```" + `
~/.config/vibediff/comments/<sha256-of-project-path>.json
` + "```" + `

Each project gets its own file. Comments are tagged with a ` + "`revision`" + ` field
so they are scoped to the commit they were left on.

---

## Comments API

### ` + "`GET %s/api/review/comments`" + `

Return comments, optionally filtered.

| Query param | Description |
|-------------|-------------|
| ` + "`revision`" + ` | Filter by revision ID. Use ` + "`working-copy`" + ` for unstaged changes. Omit to return all. |
| ` + "`file`" + `     | Filter by file path. |

### ` + "`GET %s/api/review/comments/open`" + `

Return only open (unresolved) comments.

### ` + "`GET %s/api/review/comments/resolved`" + `

Return only resolved comments.

### ` + "`GET %s/api/review/comments/latest`" + `

Return the single most-recently created open comment, or ` + "`404`" + ` if none.
Useful for simple polling scripts that just want to react to new comments.

### ` + "`POST %s/api/review/comment`" + `

Create a new comment.

` + "```" + `json
{
  "file":     "internal/git/parser.go",
  "line":     42,
  "lineEnd":  42,
  "content":  "Why is this offset by one?",
  "revision": ""
}
` + "```" + `

Returns the created Comment object with its generated ` + "`id`" + `.

### ` + "`PATCH %s/api/review/comment/{id}`" + `

Update the text of an existing comment.

` + "```" + `json
{ "content": "Updated text" }
` + "```" + `

### ` + "`POST %s/api/review/comment/{id}/resolve`" + `

Mark a comment thread as resolved.

### ` + "`POST %s/api/review/comment/{id}/reopen`" + `

Reopen a resolved comment.

### ` + "`DELETE %s/api/review/comment/{id}`" + `

Delete a comment thread and all its replies.

---

## Diff & revisions

### ` + "`GET %s/api/diff`" + `

| Query param | Values | Description |
|-------------|--------|-------------|
| ` + "`type`" + `     | ` + "`all`" + ` · ` + "`staged`" + ` · ` + "`unstaged`" + ` | Git only; ignored for jj. Default: ` + "`all`" + `. |
| ` + "`revision`" + ` | revision ID | Diff for a specific commit instead of the working copy. |

### ` + "`GET %s/api/revisions`" + `

Return recent commits. Optional ` + "`?limit=N`" + ` (default 50).
Use the returned ` + "`id`" + ` values as ` + "`revision`" + ` params elsewhere.

---

## Getting updates

### HTTP polling (simple)

All REST endpoints can be polled at any interval.
` + "`GET /api/review/comments/latest`" + ` is the lightest option — it returns only the
newest open comment so you can trigger on new activity without fetching everything.

` + "```" + `sh
# wait for a new comment, then act
while true; do
  curl -sf %s/api/review/comments/latest && break
  sleep 2
done
` + "```" + `

### WebSocket (push)

Connect to ` + "`%s/api/ws`" + ` (upgrade to ` + "`ws://`" + `) for server-push notifications.
No polling needed — the server sends a message the moment something changes:

` + "```" + `json
{ "type": "diff_updated" }
{ "type": "comment_changed" }
` + "```" + `

Reconnect with exponential back-off if the connection drops.

---

## MCP (AI agent integration)

VibeDiff includes a [Model Context Protocol](https://modelcontextprotocol.io) server
mounted at ` + "`/mcp`" + `. Point any MCP client at ` + "`%s/mcp`" + `.

> **Note:** Only one MCP session is accepted at a time.
> A second ` + "`initialize`" + ` returns ` + "`409 Conflict`" + `.

### Tools

| Tool | Description |
|------|-------------|
| ` + "`list_open_comments`" + `  | Return all open comments, each with its pinned diff hunk. |
| ` + "`wait_for_comment`" + `    | Long-poll until a new user comment arrives. Pass ` + "`next_since_id`" + ` from the previous response as cursor. Returns immediately if a backlog exists; empty array on timeout — call again to keep listening. |
| ` + "`reply_to_comment`" + `    | Post an agent reply as a child of an existing comment thread. |
| ` + "`get_full_hunk`" + `       | Fetch the complete diff hunk for one comment ID. |
| ` + "`delete_comment`" + `      | Delete a comment thread (cascades to replies). Use when the request has been addressed in code. |

### Claude Code config

` + "```" + `json
{
  "mcpServers": {
    "vibediff": {
      "type": "http",
      "url": "%s/mcp"
    }
  }
}
` + "```" + `

---

## Comment object schema

` + "```" + `json
{
  "id":        "a1b2c3d4",
  "file":      "internal/git/parser.go",
  "line":      42,
  "lineEnd":   44,
  "content":   "Why is this offset by one?",
  "author":    "user",
  "status":    "open",
  "revision":  "",
  "commit":    "abc1234",
  "createdAt": "2026-06-16T15:04:05Z"
}
` + "```" + `

` + "`author`" + ` is ` + "`\"user\"`" + ` or ` + "`\"agent\"`" + `.
` + "`status`" + ` is ` + "`\"open\"`" + ` or ` + "`\"resolved\"`" + `.
` + "`revision`" + ` is empty string for working-copy comments.
`
