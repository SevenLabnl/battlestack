---
name: test-driven-development
description: RED-GREEN-REFACTOR cycle adapted for this project's stack with vitest and 2-minute timeouts.
---

# Test-Driven Development

Use this skill when implementing features or fixing bugs. Write the test first, watch it fail, make it pass, then refactor.

## Cycle

### RED: Write a Failing Test
1. Create or open the test file in the appropriate location:
   - Utility / pure logic tests: `test/unit/<utility>.test.ts` (node env)
   - Component / auto-import tests: `test/nuxt/<component>.test.ts` (Nuxt env + happy-dom)
   - API route tests + e2e flows: `test/e2e/api/<route-name>.test.ts` (live server via `await setup({ server: true })`)
2. Write the test that describes the expected behavior
3. Run it: `pnpm test <test-file>`: confirm it fails
4. If it passes immediately, the test is not testing the right thing

### GREEN: Make It Pass
1. Write the minimum code to make the test pass
2. Run: `pnpm test <test-file>`: confirm it passes
3. Do not add features beyond what the test requires

### REFACTOR: Clean Up
1. Improve code quality without changing behavior
2. Run: `pnpm test <test-file>`: confirm it still passes
3. Check for type errors: `pnpm run lint`

## Testing Conventions

### Test Structure
```typescript
import { describe, test, expect } from 'vitest'

describe('<module>', () => {
    test('should <expected behavior>', async () => {
        // Arrange
        // Act
        // Assert
    }, { timeout: 120_000 }) // 2-minute max timeout
})
```

### API Route Tests
Use the project's test helpers:
```typescript
import { loginAsAdmin, createTestClient } from '../helpers'

test('GET /api/resource returns data', async () => {
    const client = await createTestClient()
    await loginAsAdmin(client)
    const response = await client.get('/api/resource')
    expect(response.status).toBe(200)
})
```

### What to Test
- **Always test:** API routes (happy path + error cases), database queries, auth middleware
- **Sometimes test:** Complex composables, utility functions with branching logic
- **Never test:** Simple type definitions, static config, direct Nuxt UI component rendering

## Rules
- Every test must have a timeout of 2 minutes or less
- Tests must be independent: no shared mutable state between tests
- Use descriptive test names that explain the expected behavior
- Run the full test suite before marking a task complete: `pnpm test`
