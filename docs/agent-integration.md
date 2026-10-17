# Agent integration

VibeDiff exposes everything the UI does over a local REST API, so any agent that can run `curl` can take part in a review.

**The running instance serves the latest API docs at `/docs`** (for example `http://localhost:8888/docs`), including the base URL, registered projects and every endpoint. This page is a summary and can lag behind a newer build, so point your agents at `/docs` and let them fetch it rather than hardcoding the calls below.

## Comment model

| Field | Notes |
| --- | --- |
| `id` | Assigned by the server |
| `directory` | Repo the comment belongs to. Required on root comments |
| `file`, `line`, `lineEnd` | Anchor. Omit `line` for a file-level comment; `lineEnd` makes it a range |
| `content` | Markdown |
| `author` | `user` or `agent` |
| `authorName` | Free-form tag, up to 50 chars, shown as `agent:<name>` (for example `reviewer`, `explain`) |
| `parentId` | Set on replies. File, line, revision and directory are inherited from the parent |
| `status` | `open` or `resolved` |
| `reaction` | `up`, `down`, or empty |
| `revision` | Revision the comment is on. Leave empty for the working copy. In jj repos use the change ID, not the commit hash |

## Common calls

```bash
DIR=/path/to/repo
BASE=http://localhost:8888

# What needs doing: open threads in this repo
curl "$BASE/api/review/comments?directory=$DIR"

# Open threads across every registered repo
curl "$BASE/api/review/comments/open"

# Post a comment
curl -X POST "$BASE/api/review/comment" -H 'Content-Type: application/json' -d '{
  "directory": "'"$DIR"'",
  "file": "internal/store/store.go",
  "line": 88,
  "author": "agent",
  "authorName": "reviewer",
  "content": "Error is dropped here; the caller never sees the failed write."
}'

# Reply to a thread
curl -X POST "$BASE/api/review/comment" -H 'Content-Type: application/json' -d '{
  "directory": "'"$DIR"'",
  "parentId": "<comment-id>",
  "author": "agent",
  "content": "Fixed: the error is now returned."
}'

# Resolve, reopen, react
curl -X POST "$BASE/api/review/comment/<id>/resolve"
curl -X POST "$BASE/api/review/comment/<id>/reopen"
curl -X POST "$BASE/api/review/comment/<id>/reaction" -H 'Content-Type: application/json' -d '{"reaction":"down"}'
```

Other endpoints: `GET /api/revisions`, `GET /api/diff`, `GET /api/directories`, `POST /api/directories`. See `/docs` on your instance for the full list.

## Agent skills

The workflows in the [workflows guide](workflows.md) are driven by three agent skills (Claude Code skill format):

- **vibediff**: fetch open comments, reply, resolve, react, and post comments. Wraps the API above
- **vibediff-review**: run a code review on the current diff and post findings as `agent:reviewer` comments
- **vibediff-explain**: annotate a revision with `agent:explain` comments covering why each change was made

These skills are references, not a drop-in product. They reflect one setup (jj repos, Claude Code), so copy them and adjust them for your VCS, agent and conventions. Where they disagree with `/docs` on your instance, `/docs` wins.

The skills live in [`skills/`](https://github.com/meain/vibediff/tree/main/skills). To install them for Claude Code:

```bash
cp -R skills/vibediff skills/vibediff-review skills/vibediff-explain ~/.claude/skills/
```

`vibediff` also ships a small helper, `vd.py`, which the other skills lean on. It needs Python 3 and nothing else.

A skill is a markdown file of instructions, so porting them to another agent is mostly a matter of pointing it at the API calls on this page. The explain and review skills assume a jj repo; in git repos they need adapting to use commit hashes as the revision.

## Conventions worth following

- Always set `author` to `agent` and use `authorName` to say which kind of agent you are. It lets the reviewer filter and lets reactions be attributed to the right kind of finding
- Reuse one `revision` value for all comments from a single pass so they group together
- Check for thumbs-down reactions on your earlier comments before posting similar ones again
- Don't post placeholder comments like "no issues found"
