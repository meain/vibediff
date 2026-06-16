# VibeDiff API Reference

---

## Discovery & startup

Each VibeDiff instance is a single binary serving one repository.
Default port is **8888**; pass `-port N` to change it.

```sh
vibediff                  # serve current directory on :8888
vibediff -port 9000       # custom port
vibediff main             # diff against a branch/commit instead of working copy
```

Find running instances:

```sh
lsof -iTCP -sTCP:LISTEN | grep vibediff
# or
ps aux | grep vibediff
```

Confirm which project an instance is reviewing:

```sh
curl http://localhost:8888/api/directory
# {"directory":"/path/to/repo","backend":"jj"}
```

### Switching projects at runtime

Comments for the current project are saved before loading the new one:

```sh
curl -X POST http://localhost:8888/api/directory \
  -H 'Content-Type: application/json' \
  -d '{"directory":"/other/repo"}'
```

### Comment persistence

Comments survive restarts and project switches, stored at:

```
~/.config/vibediff/comments/<sha256-of-project-path>.json
```

Each project gets its own file. Comments are tagged with a `revision` field
so they are scoped to the commit they were left on.

---

## Comments API

### `GET /api/review/comments`

Return comments, optionally filtered.

| Query param | Description |
|-------------|-------------|
| `revision`  | Filter by revision ID. Use `working-copy` for unstaged changes. Omit to return all. |
| `file`      | Filter by file path. |

### `GET /api/review/comments/open`

Return only open (unresolved) comments.

### `GET /api/review/comments/resolved`

Return only resolved comments.

### `GET /api/review/comments/latest`

Return the single most-recently created open comment, or `404` if none.
Useful for simple polling scripts that just want to react to new comments.

### `POST /api/review/comment`

Create a new comment.

```json
{
  "file":     "internal/git/parser.go",
  "line":     42,
  "lineEnd":  42,
  "content":  "Why is this offset by one?",
  "revision": "",
  "parentId": ""    // omit for a top-level comment; set to a root comment's id to reply
}
```

Returns the created Comment object with its generated `id`.

**Replies**: when `parentId` is set, `file`, `line`, `lineEnd`, and `revision`
are automatically inherited from the parent — you only need to supply `content`
and `parentId`. If you provide any of those fields they override the inherited
value. The server returns `400` if `parentId` references an unknown comment.

Only root comments (`parentId` empty) can be resolved, reopened, or deleted.
Deleting a root cascades to all its replies.

**Note**: `GET /api/review/comments` always returns a **flat array**. Grouping
replies under their parent thread is the client's responsibility — use the
`parentId` field to build the tree. The VibeDiff UI does this automatically.

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

---

## Diff & revisions

### `GET /api/diff`

| Query param | Values | Description |
|-------------|--------|-------------|
| `type`      | `all` · `staged` · `unstaged` | Git only; ignored for jj. Default: `all`. |
| `revision`  | revision ID | Diff for a specific commit instead of the working copy. |

### `GET /api/revisions`

Return recent commits. Optional `?limit=N` (default 50).
Use the returned `id` values as `revision` params elsewhere.

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
No polling needed — the server sends a message the moment something changes:

```json
{ "type": "diff_updated" }
{ "type": "comment_changed" }
```

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
| `list_open_comments`  | Return all open comments, each with its pinned diff hunk. |
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
