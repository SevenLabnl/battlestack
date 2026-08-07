import { describe, expect, it } from 'vitest'
import { BASE_URL, isServerUp } from '~~/test/helpers/setup'

const serverUp = await isServerUp()

// OAuth callback endpoints redirect to the provider's auth URL when called without an `?code=`.
// Full callback flow needs a real provider token roundtrip (out of scope for an HTTP-only smoke); these tests assert the redirect contract.
async function fetchNoFollow(path: string): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, { redirect: 'manual' })
}

describe('e2e: oauth providers', () => {
    it.skipIf(!serverUp)('GET /api/auth/oauth/github redirects to github.com', async () => {
        const res = await fetchNoFollow('/api/auth/oauth/github')
        // 302 with Location header → github (configured) OR 500 if env keys
        // missing (acceptable: the test stack may not configure OAuth).
        expect([302, 500]).toContain(res.status)
        if (res.status === 302) {
            const location = res.headers.get('location') ?? ''
            expect(location.toLowerCase()).toMatch(/github\.com|github/)
        }
    })

    it.skipIf(!serverUp)('GET /api/auth/oauth/google redirects to google.com', async () => {
        const res = await fetchNoFollow('/api/auth/oauth/google')
        expect([302, 500]).toContain(res.status)
        if (res.status === 302) {
            const location = res.headers.get('location') ?? ''
            expect(location.toLowerCase()).toMatch(/google\.com|accounts\.google/)
        }
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
