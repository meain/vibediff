# Wiring Claude Code to vibediff (`.mcp.json`)

Drop this file at the root of whichever repo you want to review with
vibediff. Claude Code auto-loads it when you launch `claude` in that
directory.

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

The file is intended to be committed so the rest of your team gets the
same wiring for free.

## Customizations

- Change the port if you started vibediff with `-port`.
- If you want the MCP server available everywhere without copying this
  file into each repo, add the same entry to `~/.claude.json` under the
  `mcpServers` key (user scope).

## Launching Claude

```bash
claude
```

Then enter the watch loop by typing `/vibediff-watch` once at the start
of your session. Claude will call `wait_for_comment` in a loop,
wake when you leave a comment in the browser, act on it, and go back
to waiting.

For one-shot pull instead, use the `/vibediff` slash command.

## What this gives you

Once Claude Code is launched with this config and `vibediff` is running:

- **Watch-loop.** `/vibediff-watch` makes Claude block in
  `wait_for_comment` and wake automatically when you add a comment.
- `list_open_comments` — fetch all currently open comments, each with
  its pinned-commit diff hunk.
- `reply_to_comment` — agent replies appear threaded under the user
  comment in the vibediff UI.
- `get_full_hunk` — re-fetch the diff hunk for a single comment.
- `comments://open` — `@`-mentionable resource.

Status changes (resolve / reopen) are not on the tool surface. Resolve
is user-driven through the vibediff UI.
