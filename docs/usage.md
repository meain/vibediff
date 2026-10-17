# Usage

## Command line

```bash
vibediff [options] [diff-target]

Options:
  -host string     Host to bind the server to (default "localhost")
  -port int        Port to bind the server to (default 8888)
  -no-open         Disable automatic browser opening
  -debug           Enable debug logging
  -version         Show version information

Environment variables:
  VIBEDIFF_NO_OPEN   Set to any value to disable automatic browser opening
```

```bash
vibediff                  # review working copy changes
vibediff main             # compare against main
vibediff HEAD~3           # compare against 3 commits ago
vibediff -no-open         # start without opening the browser
```

## Reviewing

- **Diff types**: all, staged or unstaged changes (git only; jj shows the working copy diff)
- **View modes**: side-by-side or unified
- **Comments**: click `+` on a line, or click and drag across lines for a range. Submit with the button (`Cmd+Enter`) or cancel (`Esc`)
- **Threads**: reply on any comment; mark threads resolved or reopen them. Comments show a `user` or `agent` badge
- **Copy comments**: exports all comments as markdown, for pasting into an assistant or a discussion
- **Reviewed marks**: tick the file's checkbox (`r`). The mark clears if the file's content changes. Revisions can be marked reviewed too
- **Expand context**: expand lines above or below a hunk, or the whole file
- **Full file view**: the complete file with diff highlights
- **Revision browser**: pick any commit in the sidebar to see its diff
- **Directory switcher**: move between repos without restarting
- **Display**: dark mode (follows the system), line wrapping, sticky file headers, resizable sidebar, file tree or flat list

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous file |
| `r` | Toggle reviewed |
| `?` | Show all shortcuts |
| `Esc` | Close dialogs |

Open the help dialog in the app (`?`) for the complete list.

## Where data lives

Comments are stored on disk under `~/.config/vibediff/comments/`, one file per repo, so they survive restarts. Reviewed marks live in the browser's local storage.
