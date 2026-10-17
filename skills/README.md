# VibeDiff agent skills

These skills are reference implementations, not a finished product. They reflect one person's setup (jj repos, Claude Code, a particular review style), so copy them and adapt them to yours: your VCS, your agent, your conventions for who comments as what.

- `vibediff`: fetch, post, reply to, resolve and react to comments. Includes the `vd.py` helper
- `vibediff-review`: review the current diff and post findings as `agent:reviewer` comments
- `vibediff-explain`: annotate a revision with `agent:explain` comments

Install for Claude Code:

```bash
cp -R vibediff vibediff-review vibediff-explain ~/.claude/skills/
```

## Keep them current with the API

The API can change between versions, so don't treat the calls in these skills as the source of truth. Every running instance serves its own up-to-date reference at `/docs`:

```bash
curl http://localhost:8888/docs
```

It lists the base URL, registered projects and the current endpoints. If an API call in a skill fails or behaves oddly, have your agent fetch `/docs` and follow that instead. It's worth adding a line like this to your own copy of the skill so agents do it by default.
