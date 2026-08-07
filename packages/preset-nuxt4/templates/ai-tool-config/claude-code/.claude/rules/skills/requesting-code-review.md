# Requesting Code Review

Before requesting review:

1. **Self-review**: Check for dead code, missing error handling, hardcoded values, `as any` casts, missing translations
2. **Run**: `pnpm test && pnpm run lint`: both must pass
3. **Check conventions**: File naming, API patterns, schema patterns, component structure
4. **Write PR summary**: What changed, why, how to test, files changed with rationale, risks, evidence (test results, screenshots)
5. **Create PR**: `gh pr create` with title under 70 chars and the summary as body

Never request review with failing tests or lint errors. Always explain why, not just what. Flag risky changes explicitly.
