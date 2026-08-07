# Using Git Worktrees

Use worktrees for isolated development branches:

```bash
# Create new worktree
git worktree add ../project-feature-name -b feature/feature-name

# Work in it
cd ../project-feature-name && pnpm install

# Clean up after merge
git worktree remove ../project-feature-name
git worktree prune
```

Rules:
- Always `pnpm install` in new worktrees (each has own node_modules)
- Before creating: ensure main has no uncommitted changes, branch from correct base
- Before merging: run `pnpm test && pnpm run lint`, check for migration conflicts
- After merging: delete branch, remove worktree
- If two worktrees modify database schema: merge one before continuing the other
