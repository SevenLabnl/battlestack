# Executing Plans

When working through a plan:

1. Execute one task at a time: announce, implement, verify, mark complete
2. After each task: run `pnpm run lint` (if code changed) and `pnpm test <specific-file>` (if tests exist)
3. At CHECKPOINT tasks: stop, summarize progress, wait for user confirmation
4. Between checkpoints: execute tasks sequentially without stopping
5. If verification fails: diagnose using systematic debugging, fix, re-verify before continuing
6. When all tasks complete: run `pnpm test && pnpm run lint`, then verify in browser if UI changed

Never skip verification. Never continue past a checkpoint without approval. Never mark a task complete before it passes verification.
