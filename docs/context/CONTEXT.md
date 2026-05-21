# Vibediff Context

Vibediff is a local code-review tool that surfaces diffs and
inline comments from a jj or git repository.

## Language

**Trunk**:
The default upstream branch of the repository — `main@origin`
in jj (`trunk()` revset), auto-detected via
`git symbolic-ref refs/remotes/origin/HEAD` in git with
fallback to `main` then `master`.
_Avoid_: main, master, base branch, default branch

**Revision**:
A single change in the VCS log — a jj change (identified by
change ID) or a git commit (identified by SHA). The working
copy in jj is a revision with `isWorkingCopy: true`.
_Avoid_: commit (use only for the underlying stable SHA
anchor), change

**Stack**:
The ordered set of revisions between trunk and the current
working copy (`trunk()..@` in jj). This is the default scope
of the revision list.
_Avoid_: branch, PR branch

**Full Log**:
The complete revision history up to an implementation-defined
limit (50 by default), regardless of trunk ancestry.
Accessible via the "All" toggle in the revision panel.
_Avoid_: all revisions, history

## Relationships

- A **Stack** is a subset of the **Full Log** bounded by
  **Trunk** on one end and the working copy on the other.
- A **Revision** belongs to at most one **Stack** at a time
  (relative to the current trunk).

## Example dialogue

> **Dev:** "Why does the revision list only show three entries
> when I have fifty commits in git log?"
> **Domain expert:** "The revision list defaults to the
> **Stack** — only commits since **Trunk**. Toggle 'All' to
> see the **Full Log**."
