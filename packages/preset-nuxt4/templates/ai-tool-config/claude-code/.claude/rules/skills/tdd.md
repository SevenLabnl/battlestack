# Test-Driven Development

Follow RED-GREEN-REFACTOR:

1. **RED**: Write a failing test first. Use `vitest`. Place tests in `test/unit/` (node env, pure logic), `test/nuxt/` (Nuxt env, components + auto-imports), or `test/e2e/` (live server via `await setup({ server: true })`; API route tests live under `test/e2e/api/`). Confirm it fails with `pnpm test <file>`.
2. **GREEN**: Write minimum code to pass the test. No extra features.
3. **REFACTOR**: Clean up without changing behavior. Confirm tests still pass.

Rules:
- Every test gets `{ timeout: 120_000 }` (2-minute max)
- Tests must be independent (no shared mutable state)
- Always test: API routes (happy + error), database queries, auth middleware
- Sometimes test: complex composables, branching utility functions
- Never test: type definitions, static config, simple component rendering
- Use project test helpers: `loginAsAdmin()`, `createTestClient()`
- Run full suite before marking work complete: `pnpm test`
