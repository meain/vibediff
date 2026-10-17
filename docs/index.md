---
title: VibeDiff
aside: false
---

# VibeDiff

A local diff viewer for Git and Jujutsu, for reviewing code an AI agent wrote.

You comment on lines in the diff. Your agent reads the threads, fixes the code and replies. It all runs on your machine in one binary.

![VibeDiff screenshot](https://github.com/user-attachments/assets/cc2bf145-4b0c-4b94-9322-df27a11b3e94)

## Try it

```bash
cd your-repo
vibediff
```

Your browser opens on `http://localhost:8888` with the working copy diff. Click `+` on a line to leave a comment.

## Read on

- [Installation](installation)
- [A review, start to finish](workflows)
- [Wiring up your agent](agent-integration)
- [UI features and shortcuts](usage)
