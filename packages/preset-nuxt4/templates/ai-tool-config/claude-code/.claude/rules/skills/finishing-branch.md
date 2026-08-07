# Finishing a Development Branch

When a branch is complete:

1. **Verify**: `pnpm test && pnpm run lint`, UI checked in browser, migrations generated
2. **Choose method**: Small change = direct merge. Feature = squash merge or PR. Needs review = PR.
3. **Integrate**:
   - Direct: `git checkout main && git pull && git merge feature/name && pnpm test`
   - PR: Use requesting-code-review workflow
   - Squash: `git checkout main && git merge --squash feature/name && git commit`
4. **Clean up**: Delete branch (`git branch -d`, `git push origin --delete`), remove worktree if used
5. **Final test**: `pnpm test && pnpm run lint` on main
6. **Announce**: What merged, how to test, follow-up tasks

Never merge with failing tests. Never force-push to main. Always pull latest main before merging.
