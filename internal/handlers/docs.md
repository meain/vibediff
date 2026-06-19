# VibeDiff API Reference

---

## Discovery & startup

VibeDiff is a single binary that can review **multiple repositories** at once.
Each API call identifies the repository via a `directory` query parameter.
Default port is **8888**; pass `-port N` to change it.

```sh
vibediff                  # auto-registers CWD, opens browser on :8888
vibediff -port 9000       # custom port
vibediff main             # diff against a branch/commit instead of working copy
```

The server auto-registers the working directory it was started from.
Additional directories can be registered at runtime via the registry API.

Find running instances:

```sh
lsof -iTCP -sTCP:LISTEN | grep vibediff
# or
ps aux | grep vibediff
```

---

## Directory registry

VibeDiff maintains a persistent list of known project directories
(`~/.config/vibediff/directories.json`).

### `GET /api/directories`

Return the list of all registered directories.

```json
["/path/to/repo-a", "/path/to/repo-b"]
```

### `POST /api/directories`

Register a new directory. Validates it is a git or jj repository first.

```json
{ "directory": "/path/to/repo" }
```

Returns `{ "directory": "/path/to/repo", "backend": "git" }` on success,
or `400` if the path is not a valid repository.

### `DELETE /api/directories/{path}`

Remove a directory from the registry. URL-encode the path.

```sh
curl -X DELETE 'http://localhost:8888/api/directories/%2Fpath%2Fto%2Frepo'
```

### `POST /api/directories/validate`

Check whether a path is a valid repository without registering it.

```json
{ "directory": "/path/to/repo" }
```

Returns `{ "valid": true }` or `{ "valid": false, "error": "not a git or jj repository" }`.

### `GET /api/directory`

Return the VCS backend for a specific directory.

```sh
curl 'http://localhost:8888/api/directory?directory=/path/to/repo'
# {"directory":"/path/to/repo","backend":"jj"}
```

### Comment persistence

Comments are stored per-project at:

```
~/.config/vibediff/comments/<sha256-of-project-path>.json
```

Each project gets its own file. Comments are tagged with a `revision` field
so they are scoped to the commit they were left on.

---

## Comments API

All comment endpoints require a `directory` parameter to scope the operation
to a specific project.

### `GET /api/review/comments`

Return comments for a directory, optionally filtered.

| Query param | Description |
|-------------|-------------|
| `directory` | **Required.** Project directory path. |
| `revision`  | Filter by revision ID. Use `working-copy` for unstaged changes. Omit to return all. |
| `file`      | Filter by file path. |

### `GET /api/review/comments/open`

Return all open (unresolved) comments across all registered directories.

### `GET /api/review/comments/resolved`

Return all resolved comments across all registered directories.

### `GET /api/review/comments/latest`

Return the single most-recently created open comment across all directories,
or `404` if none. Useful for polling scripts.

### `POST /api/review/comment`

Create a new comment.

```json
{
  "directory": "/path/to/repo",
  "file":      "internal/git/parser.go",
  "line":      42,
  "lineEnd":   42,
  "content":   "Why is this offset by one?",
  "revision":  "",
  "parentId":  ""
}
```

Returns the created Comment object with its generated `id`.

**Replies**: when `parentId` is set, `file`, `line`, `lineEnd`, `revision`, and
`directory` are automatically inherited from the parent — you only need to
supply `content` and `parentId`.

### `PATCH /api/review/comment/{id}`

Update the text of an existing comment.

```json
{ "content": "Updated text" }
```

### `POST /api/review/comment/{id}/resolve`

Mark a comment thread as resolved.

### `POST /api/review/comment/{id}/reopen`

Reopen a resolved comment.

### `DELETE /api/review/comment/{id}`

Delete a comment thread and all its replies.

### `DELETE /api/review/comments`

Clear all comments for a directory.

| Query param | Description |
|-------------|-------------|
| `directory` | If provided, clears only that directory's comments. Omit to clear all. |

---

## Diff & revisions

All diff and revision endpoints require a `directory` query parameter.

### `GET /api/diff`

| Query param | Values | Description |
|-------------|--------|-------------|
| `directory` | path   | **Required.** Project directory. |
| `type`      | `all` · `staged` · `unstaged` | Git only; ignored for jj. Default: `all`. |
| `revision`  | revision ID | Diff for a specific commit instead of the working copy. |

### `GET /api/diff/{file}`

Diff for a single file.

| Query param | Values | Description |
|-------------|--------|-------------|
| `directory` | path   | **Required.** |
| `type`      | `all` · `staged` · `unstaged` | Default: `all`. |
| `revision`  | revision ID | Optional. |

### `GET /api/diff/{file}/full`

Full file content with diff annotations.

| Query param | Values | Description |
|-------------|--------|-------------|
| `directory` | path   | **Required.** |
| `type`      | `all` · `staged` · `unstaged` | Default: `all`. |
| `revision`  | revision ID | Optional. |

### `GET /api/revisions`

Return recent commits.

| Query param | Values | Description |
|-------------|--------|-------------|
| `directory` | path   | **Required.** |
| `limit`     | integer | Default: 50. |

Use the returned `id` values as `revision` params elsewhere.

### `GET /api/file`

Return raw file content.

| Query param | Values | Description |
|-------------|--------|-------------|
| `directory` | path   | **Required.** |
| `path`      | relative file path | **Required.** |

---

## UI deep links

The browser UI syncs its current state to URL query parameters so that
bookmarks and shared links restore the exact view:

| Param       | Description |
|-------------|-------------|
| `dir`       | Active project directory path. |
| `rev`       | Selected revision ID (omitted for working copy). |
| `file`      | Selected file path. |

Example: `http://localhost:8888/?dir=/path/to/repo&rev=abc123&file=main.go`

---

## Getting updates

### HTTP polling (simple)

All REST endpoints can be polled at any interval.
`GET /api/review/comments/latest` is the lightest option — it returns only the
newest open comment so you can trigger on new activity without fetching everything.

```sh
# wait for a new comment, then act
while true; do
  curl -sf http://localhost:8888/api/review/comments/latest && break
  sleep 2
done
```

### WebSocket (push)

Connect to `/api/ws` (upgrade to `ws://`) for server-push notifications.
No polling needed — the server sends a message the moment something changes.
Messages include the `directory` that changed so clients can ignore updates
for directories they are not currently viewing:

```json
{ "type": "diff_updated",    "directory": "/path/to/repo", "timestamp": 1718000000 }
{ "type": "comment_changed", "directory": "/path/to/repo", "timestamp": 1718000000 }
```

`directory` is the repository where the change occurred.
Reconnect with exponential back-off if the connection drops.

---

## MCP (AI agent integration)

VibeDiff includes a [Model Context Protocol](https://modelcontextprotocol.io) server
mounted at `/mcp`. Point any MCP client at `http://localhost:8888/mcp`.

> **Note:** Only one MCP session is accepted at a time.
> A second `initialize` returns `409 Conflict`.

### Tools

| Tool | Description |
|------|-------------|
| `list_open_comments`  | Return all open comments across all registered directories, each with its pinned diff hunk. |
| `wait_for_comment`    | Long-poll until a new user comment arrives. Pass `next_since_id` from the previous response as cursor. Returns immediately if a backlog exists; empty array on timeout — call again to keep listening. |
| `reply_to_comment`    | Post an agent reply as a child of an existing comment thread. |
| `get_full_hunk`       | Fetch the complete diff hunk for one comment ID. |
| `delete_comment`      | Delete a comment thread (cascades to replies). Use when the request has been addressed in code. |

### Claude Code config

```json
{
  "mcpServers": {
    "vibediff": {
      "type": "http",
      "url": "http://localhost:8888/mcp"
    }
  }
}
```

---

## Comment object schema

```json
{
  "id":        "a1b2c3d4",
  "directory": "/path/to/repo",
  "file":      "internal/git/parser.go",
  "line":      42,
  "lineEnd":   44,
  "content":   "Why is this offset by one?",
  "author":    "user",
  "parentId":  "",
  "status":    "open",
  "revision":  "",
  "commit":    "abc1234",
  "createdAt": "2026-06-16T15:04:05Z"
}
```

`author` is `"user"` or `"agent"`.
`status` is `"open"` or `"resolved"`.
`parentId` is empty for root comments; set to a root comment's `id` for replies.
The API always returns a flat array — clients group by `parentId`.
`revision` is empty string for working-copy comments.
`directory` is the project path the comment belongs to.
