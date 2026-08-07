---
name: finishing-a-development-branch
description: Merge, PR, or cleanup decision workflow for completed branches.
---

# Finishing a Development Branch

Use this skill when a feature branch is complete and needs to be integrated into the main codebase.

## Decision Flow

### 1. Verify Completeness
Before anything else, run the **verification-before-completion** checklist:
- All tests pass: `pnpm test`
- No lint errors: `pnpm run lint`
- UI changes verified via browser
- Database migrations generated (if schema changed)

### 2. Choose Integration Method

| Situation | Method |
|---|---|
| Small, self-contained change | Direct merge to main |
| Feature with multiple commits | Squash merge or PR |
| Work that needs team review | Pull request |
| Experimental work to discard | Delete branch |

### 3. Prepare for Integration

**If merging directly:**
```bash
git checkout main
git pull origin main
git merge feature/branch-name
pnpm test  # Verify after merge
```

**If creating a PR:**
Use the **requesting-code-review** skill to prepare the PR with proper context.

**If squash merging:**
```bash
git checkout main
git merge --squash feature/branch-name
git commit -m "feat: descriptive message for the entire feature"
```

### 4. Post-Integration Cleanup

1. Delete the feature branch:
   ```bash
   git branch -d feature/branch-name
   git push origin --delete feature/branch-name
   ```

2. If using a worktree, clean it up:
   ```bash
   git worktree remove ../project-feature-name
   ```

3. Run the full test suite one more time on main:
   ```bash
   pnpm test && pnpm run lint
   ```

### 5. Announce
Tell the user:
- What was merged
- How to test it (if applicable)
- Any follow-up tasks or known limitations

## Rules
- Never merge a branch with failing tests
- Never force-push to main/master
- Always pull the latest main before merging
- Clean up branches and worktrees after integration
