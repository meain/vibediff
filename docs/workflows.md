# Workflows

These workflows assume VibeDiff is already running in the background (see [installation](installation.md#run-it-as-a-background-server)). To start any of them, switch to the VibeDiff tab and pick your project from the directory drop-down. There's no need to run `vibediff` again. Agent steps are described as what you'd say to the agent; the [agent integration](agent-integration.md) page covers what happens underneath. The skills used below ([`vibediff`](https://github.com/meain/vibediff/blob/master/skills/vibediff/SKILL.md), [`vibediff-review`](https://github.com/meain/vibediff/blob/master/skills/vibediff-review/SKILL.md) and [`vibediff-explain`](https://github.com/meain/vibediff/blob/master/skills/vibediff-explain/SKILL.md)) are examples you can adapt; see [agent integration](agent-integration.md#agent-skills).

## Review what an agent just wrote

The core loop. Your agent has made changes in the working copy and you want to review them properly before they get committed.

1. Switch to the VibeDiff tab and select your project from the drop-down. The diff is already there and keeps updating.
2. Read through the files. Mark each file reviewed once you're happy with it (the checkbox, or `r`).
3. On anything wrong, click `+` on the line (or drag across a range) and write a short comment: "this swallows the error", "use the existing helper in `util/retry.go`".
4. Tell the agent: *"check vibediff and address the open comments"*. This uses the [`vibediff` skill](https://github.com/meain/vibediff/blob/master/skills/vibediff/SKILL.md).
5. The agent fetches the open threads, edits the code, and replies on each thread with what it did. You see the diff change live.
6. Resolve the threads that are fixed. Reopen any that aren't, with a follow-up reply.

Files you marked reviewed stay marked until their content changes, so on the second pass you only re-read what the agent touched.

### Recommended: keep the agent's fixes in a separate commit

Before the agent starts on your comments, put its work in a commit of its own and squash it into the original afterwards. The working copy diff then contains only what the agent changed in response to your feedback, so the second pass is a small review instead of a re-read of the whole change.

This is easiest in jj, where starting a new change is one cheap command:

```bash
jj new -m "wip: address review comments"   # before telling the agent to fix things
# agent fixes the code; VibeDiff's working copy diff shows only those fixes
jj squash                                  # once you're happy, fold them into the parent
```

The earlier revision stays in the revision browser with your comments pinned to it, and the fixes show up as their own diff. Resolve the threads as you confirm each fix, then squash.

The same idea works in git, but takes a bit more ceremony: commit the original work, let the agent commit its fixes separately (`git commit --fixup <sha>`), and fold them in with `git rebase -i --autosquash` when you're done.

If you'd rather not run an integration, use the **Copy Comments** button and paste the markdown into your agent. You lose the threading and resolve state, but nothing else is needed.

## Let an agent review first

Before you spend your own attention on a diff, have a second agent look for correctness problems and post them where you'll read them.

1. Finish a change, human or agent.
2. Tell the agent: *"/vibediff-review"* (optionally with an effort level, like `high`).
3. The [`vibediff-review` skill](https://github.com/meain/vibediff/blob/master/skills/vibediff-review/SKILL.md) runs a code review on the current diff and posts each finding as a comment on the file and line, tagged `agent:reviewer`.
4. Open VibeDiff. The findings sit inline next to the code instead of in a chat summary. Thumbs-down the ones that are noise.
5. On later runs the reviewer reads your thumbs-down reactions and stops raising that kind of finding.

This works well as a pre-commit pass on your own changes too.

## Explain a commit

Reading a large commit or a colleague's PR is easier when the author's intent is attached to the code.

1. Check out or point at the revision you want to understand.
2. Tell the agent: *"/vibediff-explain `<revision>`"*, which runs the [`vibediff-explain` skill](https://github.com/meain/vibediff/blob/master/skills/vibediff-explain/SKILL.md).
3. The agent reads the diff and the commit message and posts 10 to 20 comments tagged `agent:explain`, each on a non-obvious line, covering why the change was made rather than what it does.
4. In VibeDiff, select that revision in the sidebar and read the diff with the explanations inline. Reply to any comment to ask a follow-up.

## Review a branch or a past commit

```bash
vibediff main        # everything since main
vibediff HEAD~3      # last three commits
```

You can also click any revision in the sidebar to see its diff. Comments are pinned to the revision (and commit SHA) they were made on, so feedback on an earlier commit doesn't get attached to the wrong code after a rebase or amend.

In jj repos, comments use the jj change ID, which survives rewrites.

## Run one instance for all your repos

The suggested setup is a single long-running VibeDiff in the background, not one per repo:

```bash
vibediff -no-open &    # or under tmux, launchd or systemd
```

Bookmark `http://localhost:8888` and use the directory switcher to move between repos. Agents in any repo post to the same URL, so you have one place to review everything.

Register directories from the switcher, or through the API:

```bash
curl -X POST http://localhost:8888/api/directories \
  -H 'Content-Type: application/json' \
  -d '{"directory":"/path/to/other-repo"}'
```

Comments are stored per directory, so each repo keeps its own threads. Agents working in different repos can all talk to the same instance.

## Triage everything outstanding

To see every open thread across all registered repos, which is handy when several agents are running:

```bash
curl http://localhost:8888/api/review/comments/open
```
