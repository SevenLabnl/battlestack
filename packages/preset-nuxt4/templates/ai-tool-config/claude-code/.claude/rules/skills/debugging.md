# Systematic Debugging

When a bug is not immediately obvious:

1. **Reproduce**: Trigger the exact failure. Document the error message and stack trace.
2. **Narrow scope**: Is it client-side (app/), server-side (server/), shared (types/), or config?
3. **Hypothesize**: "The bug is likely caused by ___." Common causes: Drizzle schema mismatch, missing env var, auth middleware misconfigured, WebSocket connection dropped / not closed, i18n key missing, Zod/TS type mismatch.
4. **Test hypothesis**: Make the smallest change to confirm or deny (add console.log, check DB state, verify env var).
5. **Fix**: Address root cause, not symptom.
6. **Verify**: Run the failing test, run related tests, run `pnpm test && pnpm run lint`.
7. **Document**: If non-obvious, add a code comment explaining the fix.

Never change multiple things at once. Never skip reproduction. Never add workarounds without understanding root cause.
