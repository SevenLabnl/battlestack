# Verification Before Completion

Before claiming any task is done, gather evidence:

1. **Tests pass**: `pnpm test`: all green, no skipped tests without justification
2. **Type check**: `pnpm run lint`: zero TypeScript errors
3. **Build** (if config changed): `pnpm run build`
4. **Browser** (if UI changed): Navigate to the page, take screenshot, verify interactivity
5. **Database** (if schema changed): Migration generated, applies cleanly, seed still works
6. **i18n** (if user-facing text): NL and EN translations present, no hardcoded strings

Never say "I believe this works"; show proof. Never skip tests because "the change is small". If something cannot be verified, state what and why explicitly.
