---
name: using-git-worktrees
description: Isolated development branches using git worktrees. Prevents interference between parallel work streams.
---

# Using Git Worktrees

Use this skill when you need to work on an isolated branch without affecting the main working directory. Worktrees let you have multiple branches checked out simultaneously.

## When to Use Worktrees

- Parallel agent work that might touch overlapping areas
- Experimental changes you want to isolate
- Long-running features that should not block other work
- Reviewing someone else's branch while keeping your work intact

## Creating a Worktree

```bash
# Create a new worktree with a new branch
git worktree add ../project-feature-name -b feature/feature-name

# Create a worktree from an existing branch
git worktree add ../project-feature-name feature/existing-branch
```

### Naming Convention
- Directory: `../<project-name>-<feature-short-name>`
- Branch: `feature/<descriptive-name>`

## Working in a Worktree

1. **Navigate** to the worktree directory
2. **Install dependencies**: `pnpm install` (each worktree has its own node_modules)
3. **Work normally**: commits, tests, everything works as expected
4. **Run tests** in the worktree context: `cd ../project-feature-name && pnpm test`

## Safety Checks

Before creating a worktree:
- Ensure the main working directory has no uncommitted changes
- Verify you are branching from the correct base (usually `main` or `develop`)

Before merging a worktree:
- Run `pnpm test && pnpm run lint` in the worktree
- Check for migration conflicts if database schema was changed
- Verify no drift has occurred on the base branch

## Cleaning Up

```bash
# Remove the worktree (after merging or discarding)
git worktree remove ../project-feature-name

# If the directory was manually deleted
git worktree prune
```

## Rules
- Always install dependencies in new worktrees
- Never share `node_modules` between worktrees
- Clean up worktrees after merging; do not leave stale branches
- If two worktrees both modify database schema, merge one before continuing the other
