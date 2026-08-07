# Receiving Code Review

When responding to review feedback:

1. Read all comments first; understand overall direction before acting
2. Categorize: bug (fix + add test), style (fix if matches conventions), architecture (evaluate before implementing), question (answer with code refs), nitpick (fix)
3. Verify architecture suggestions against project stack before implementing
4. Fix each comment in a separate focused change
5. Run `pnpm test` after each fix
6. Respond to each comment: "Fixed in [commit]" / declined with reason / clarifying question
7. Final: `pnpm test && pnpm run lint`, push, request re-review

Never implement suggestions you do not understand. Never ignore comments without responding. Always add tests for bugs found during review.
