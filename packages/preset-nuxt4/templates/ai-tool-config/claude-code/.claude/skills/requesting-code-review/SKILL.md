---
name: requesting-code-review
description: Pre-merge review checklist. Prepare a branch for review with evidence and context.
---

# Requesting Code Review

Use this skill when a branch is ready for review. Prepare the review request with enough context that the reviewer can work efficiently.

## Before Requesting Review

### 1. Self-Review
Read through every changed file. Check for:
- Dead code or debugging artifacts (`console.log`, commented-out code)
- Missing error handling
- Hardcoded values that should be environment variables or config
- Type safety issues (any `as any` casts, missing null checks)
- Missing i18n translations

### 2. Run Full Verification
```bash
pnpm test && pnpm run lint
```
Both must pass with zero errors.

### 3. Check Conventions
Review the project's conventions file (CLAUDE.md / GEMINI.md / .cursorrules) and verify:
- File naming matches conventions
- API route patterns match existing routes
- Database schema follows existing patterns
- Component structure matches existing components

### 4. Prepare the Review Request

Write a summary that includes:

```markdown
## What Changed
<1-3 sentences describing the feature or fix>

## Why
<Business context or technical motivation>

## How to Test
1. <Step-by-step instructions>
2. <Include test credentials if needed>

## Files Changed
- `path/to/file.ts` — <what changed and why>
- `path/to/other.ts` — <what changed and why>

## Risks
- <Anything the reviewer should pay special attention to>
- <Edge cases that might not be obvious>

## Evidence
- Tests: <pass count>
- Lint: clean
- Browser: <screenshot or description>
```

### 5. Create PR
Use `gh pr create` with the summary as the PR body. Keep the title under 70 characters.

## Rules
- Never request review with failing tests
- Never request review without running lint
- Always explain *why*, not just *what*
- Flag risky changes explicitly; do not hide complexity
