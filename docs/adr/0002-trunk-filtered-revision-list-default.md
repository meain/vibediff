# Trunk-filtered revision list as the default

The revision list (`GET /api/revisions`) defaults to returning
only commits between trunk and the working copy (`trunk()..@`
in jj; `<default-branch>..HEAD` in git). A `?all=true` query
param restores the previous limit-based full log. This makes
the default view meaningful for code review — showing exactly
the stack under review — rather than an arbitrary window of
recent history that silently truncates deep stacks.

## Considered Options

**Limit-based (previous default):** Simple to implement, no
trunk detection required, but silently wrong when the stack
exceeds the limit (50). A reviewer would never see older
commits in the stack without realising the list was truncated.

**Frontend filtering:** Filter the limit-based list client-side.
Rejected for the same reason — if the stack is deeper than the
limit, commits disappear silently.

## Consequences

- Git trunk is auto-detected via
  `git symbolic-ref refs/remotes/origin/HEAD`, falling back to
  `main` then `master`. If detection fails, the backend falls
  back to full log silently.
- The "All" toggle in the revision panel title bar is component
  state only; it resets to trunk-filtered on reload.
