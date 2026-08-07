---
name: executing-plans
description: Work through a plan systematically with verification at each step and human checkpoints.
---

# Executing Plans

Use this skill when you have a written plan and need to implement it step by step.

## Process

### 1. Load the Plan
Read the plan file. Identify the first unchecked task.

### 2. Execute One Task at a Time
For each task:
1. **Announce** what you are about to do (one sentence)
2. **Implement** the change
3. **Verify** using the task's verification criteria
4. **Mark complete** by checking the box in the plan file
5. **Move to next** task

### 3. Verification After Each Task
Run the task's specific verification. At minimum:
- If you wrote code: `pnpm run lint` to check for type errors
- If you wrote tests: `pnpm test <specific-test-file>` to confirm they pass
- If you changed UI: check via Playwright MCP or tell the user to verify

### 4. Human Checkpoints
When you reach a checkpoint task:
1. Stop executing
2. Summarize what was done so far
3. Show the specific thing that needs review
4. Wait for user confirmation before continuing

### 5. Batch Execution
Between checkpoints, execute tasks in sequence without stopping. This keeps momentum while still providing review points at critical junctures.

## Error Handling

If a task fails verification:
1. Do not move to the next task
2. Diagnose the failure using the **systematic-debugging** skill
3. Fix the issue
4. Re-verify
5. Only then mark complete and continue

## Completion

When all tasks are checked:
1. Run full project verification: `pnpm test && pnpm run lint`
2. Update the plan file to note completion
3. Invoke the **verification-before-completion** skill before reporting done

## Anti-Patterns

- Do not skip verification steps to save time
- Do not execute tasks out of order unless dependencies allow it
- Do not mark a task complete before verification passes
- Do not continue past a checkpoint without user approval
