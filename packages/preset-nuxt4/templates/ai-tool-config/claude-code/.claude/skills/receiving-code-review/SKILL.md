---
name: receiving-code-review
description: Respond to review feedback with rigor. Verify suggestions before implementing them blindly.
---

# Receiving Code Review

Use this skill when responding to code review feedback. Treat every comment as a potential improvement, but verify before implementing.

## Process

### 1. Read All Comments First
Do not start fixing after the first comment. Read the entire review to understand:
- The overall direction of feedback
- Whether comments conflict with each other
- Which comments are blocking vs suggestions

### 2. Categorize Each Comment

| Category | Action |
|---|---|
| **Bug found** | Fix immediately, add a test that catches it |
| **Style/convention** | Fix if it matches project conventions |
| **Architecture suggestion** | Evaluate against project constraints before implementing |
| **Question** | Answer with specific code references |
| **Nitpick** | Fix unless it conflicts with project conventions |

### 3. Verify Before Implementing
For architecture suggestions or significant changes:
1. Check if the suggestion is compatible with the project stack (Nuxt SSR, Drizzle, etc.)
2. Check if it would break existing tests
3. If uncertain, ask a clarifying question rather than guessing

### 4. Implement Fixes
- Fix each comment in a separate, focused change
- Run `pnpm test` after each fix to catch regressions early
- Do not introduce new features while addressing review comments

### 5. Respond to Each Comment
For each review comment:
- If fixed: "Fixed in [commit hash]" or "Fixed: added test in `test/e2e/api/route.test.ts`"
- If declined: Explain why with a specific technical reason
- If needs discussion: Ask a targeted question

### 6. Final Verification
After all changes:
```bash
pnpm test && pnpm run lint
```

Push the fixes and request re-review.

## Rules
- Never implement a suggestion you do not understand
- Never ignore a comment without responding
- Always add tests for bugs found during review
- Keep fix commits separate from new feature work
