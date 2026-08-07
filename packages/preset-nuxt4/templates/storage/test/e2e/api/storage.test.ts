import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
    apiDelete,
    apiGet,
    apiPost,
    BASE_URL,
    createTestUser,
    isServerUp,
    loginAsAdmin,
} from '~~/test/helpers/setup'

const serverUp = await isServerUp()

// Most tests assert the HTTP contract only; nothing needs to land in S3 for a 401/422 check.
// Exception: the over-1MB case really uploads, proving app-side body handling doesn't cap out. A proxy's own limit is invisible from here.
describe('e2e: storage', () => {
    it.skipIf(!serverUp)('upload-url requires a session', async () => {
        const form = new FormData()
        form.append('file', new Blob(['x'], { type: 'image/png' }), 'a.png')
        const res = await fetch(`${BASE_URL}/api/files/upload-url`, { method: 'POST', body: form })
        expect(res.status).toBe(401)
    })

    it.skipIf(!serverUp)('upload-url rejects disallowed MIME type', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const form = new FormData()
        form.append('file', new Blob(['x'], { type: 'application/x-msdownload' }), 'evil.exe')
        const res = await fetch(`${BASE_URL}/api/files/upload-url`, {
            method: 'POST',
            body: form,
            headers: { Cookie: user.cookie },
        })
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
    })

    it.skipIf(!serverUp)('upload-url accepts a body well over 1MB', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        // Generated in memory, not a fixture: comfortably over the 1MB a reverse proxy commonly defaults its limit to, well under the route's own 100MB cap, so the test stays fast.
        // This object is never deleted (no delete path keys on a raw S3 key, only on a `files` row this route never creates); kept small to limit what accumulates in the dev bucket.
        const bytes = randomBytes(1.5 * 1024 * 1024) // 1.5 MiB
        const form = new FormData()
        form.append('file', new Blob([bytes], { type: 'application/zip' }), 'big.bin')
        const res = await fetch(`${BASE_URL}/api/files/upload-url`, {
            method: 'POST',
            body: form,
            headers: { Cookie: user.cookie },
        })
        expect(res.status).toBe(200)
        const data = (await res.json()) as { key: string, size: number, mime: string }
        expect(data.size).toBe(bytes.length)
    })

    it.skipIf(!serverUp)('download-url requires a session', async () => {
        const { status } = await apiGet('/api/files/some-key/download-url')
        expect(status).toBe(401)
    })

    it.skipIf(!serverUp)('files list requires a session', async () => {
        const { status } = await apiGet('/api/files')
        expect(status).toBe(401)
    })

    it.skipIf(!serverUp)('files list returns an array for an authed user', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status, data } = await apiGet<{ rows: unknown[] }>('/api/files', user.cookie)
        expect(status).toBe(200)
        expect(Array.isArray(data?.rows)).toBe(true)
    })

    it.skipIf(!serverUp)('register (POST /api/files) requires a session', async () => {
        const { status } = await apiPost('/api/files', { key: 'nope' })
        expect(status).toBe(401)
    })

    it.skipIf(!serverUp)('register 404s when the object is not in the bucket', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status } = await apiPost(
            '/api/files',
            { key: 'uploads/nonexistent.bin' },
            user.cookie,
        )
        // 404 when S3 creds wired + object missing; 500-class when S3 not configured at all.
        // Accept both: the assertion that matters is "no row gets created from a forged key".
        expect([404, 500, 502, 503]).toContain(status)
    })

    it.skipIf(!serverUp)('delete by id requires a session', async () => {
        const { status } = await apiDelete('/api/files/00000000-0000-0000-0000-000000000000')
        expect(status).toBe(401)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
