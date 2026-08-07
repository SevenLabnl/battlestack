---
name: verification-before-completion
description: Gather evidence that work is correct before telling the user you are done. No assertions without proof.
---

# Verification Before Completion

Use this skill before telling the user that a task is complete. Every claim of completion must be backed by evidence.

## Checklist

Run through every applicable item before reporting done:

### 1. Tests Pass
```bash
pnpm test
```
All tests must pass. If any fail, fix them before proceeding.

### 2. Type Check
```bash
pnpm run lint
```
No TypeScript errors. No lint warnings that indicate real issues.

### 3. Build Check (if applicable)
If you changed nuxt.config.ts, added modules, or modified the build pipeline:
```bash
pnpm run build
```

### 4. Browser Verification (if UI changes)
Use the Playwright MCP server to:
1. Navigate to the affected page
2. Take a screenshot
3. Verify the UI matches expectations
4. Test interactive elements (clicks, form submissions)

### 5. Database Verification (if schema changes)
- Confirm migration was generated: check `server/database/migrations/` for new file
- Confirm migration applies cleanly (no SQL errors)
- Verify seed data still works: `pnpm run db:seed`

### 6. i18n Verification (if user-facing text)
- NL translations present in `i18n/locales/nl.ts`
- EN translations present in `i18n/locales/en.ts`
- No hardcoded strings in Vue templates

## Evidence Format

When reporting completion, include:
- Test results (pass count, any skipped tests and why)
- Screenshot of UI changes (if applicable)
- Specific files changed (list of paths)

## Rules
- Never say "I believe this works"; show proof
- Never skip tests because "the change is small"
- If you cannot verify something (e.g., email sending), explicitly state what could not be verified and why
- If a test is flaky, investigate; do not ignore
