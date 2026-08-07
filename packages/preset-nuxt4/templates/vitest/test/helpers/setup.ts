import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Best-effort `.env` loader so a fresh `pnpm test` shell has `NUXT_PORT`, `SEED_ADMIN_*`, etc. populated; values already in `process.env` (CI sets these explicitly) win over the file.
 * Vitest doesn't read `.env` automatically; inlining a minimal parser here keeps the test helper standalone instead of depending on `vite-plugin-env`.
 */
function loadDotEnv(): void {
    const envPath = path.resolve('.env')
    if (!existsSync(envPath)) return
    let content: string
    try {
        content = readFileSync(envPath, 'utf8')
    } catch {
        return
    }
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const stripped = line.startsWith('export ') ? line.slice(7) : line
        const eq = stripped.indexOf('=')
        if (eq <= 0) continue
        const key = stripped.slice(0, eq).trim()
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
        if (key in process.env) continue
        let value = stripped.slice(eq + 1).trim()
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
            value = value.slice(1, -1)
                .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
                .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        } else if (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2) {
            value = value.slice(1, -1)
        } else {
            const hash = value.indexOf(' #')
            if (hash >= 0) value = value.slice(0, hash).trimEnd()
        }
        process.env[key] = value
    }
}

loadDotEnv()

/**
 * Resolves the e2e base URL: `TEST_BASE_URL` (CI sets this explicitly), else `NUXT_HOST`+`NUXT_PORT` from `process.env`, else `http://localhost:3000`.
 * Each project gets its own allocated `NUXT_PORT`, so defaulting straight to 3000 would silently skip every e2e test on a fresh scaffold.
 */
function resolveBaseUrl(): string {
    if (process.env.TEST_BASE_URL) return process.env.TEST_BASE_URL
    const port = process.env.NUXT_PORT
    if (port) {
        const host = process.env.NUXT_HOST && process.env.NUXT_HOST !== '0.0.0.0'
            ? process.env.NUXT_HOST
            : 'localhost'
        return `http://${host}:${port}`
    }
    return 'http://localhost:3000'
}

export const BASE_URL = resolveBaseUrl()

export interface TestUser {
    id: string
    name: string
    email: string
    role: string
    cookie: string
}

interface ApiResult<T = unknown> {
    status: number
    data: T | null
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    })
}

async function readJson<T = unknown>(res: Response): Promise<T | null> {
    try {
        return (await res.json()) as T
    } catch {
        return null
    }
}

export async function apiGet<T = unknown>(path: string, cookie?: string): Promise<ApiResult<T>> {
    const res = await apiFetch(path, {
        headers: cookie ? { Cookie: cookie } : {},
    })
    return { status: res.status, data: await readJson<T>(res) }
}

export async function apiPost<T = unknown>(
    path: string,
    body: unknown,
    cookie?: string,
): Promise<ApiResult<T>> {
    const res = await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: cookie ? { Cookie: cookie } : {},
    })
    return { status: res.status, data: await readJson<T>(res) }
}

export async function apiPut<T = unknown>(
    path: string,
    body: unknown,
    cookie?: string,
): Promise<ApiResult<T>> {
    const res = await apiFetch(path, {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: cookie ? { Cookie: cookie } : {},
    })
    return { status: res.status, data: await readJson<T>(res) }
}

export async function apiDelete<T = unknown>(path: string, cookie?: string): Promise<ApiResult<T>> {
    const res = await apiFetch(path, {
        method: 'DELETE',
        headers: cookie ? { Cookie: cookie } : {},
    })
    return { status: res.status, data: await readJson<T>(res) }
}

/** Log in via `/api/auth/login` and return the session cookie value. */
export async function loginAs(email: string, password: string): Promise<string> {
    const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error(`login failed: ${res.status} ${res.statusText}`)

    const cookies = res.headers.getSetCookie()
    const sessionCookie = cookies.find((c: string) => c.startsWith('nuxt-session='))
    if (!sessionCookie) throw new Error('no session cookie returned by /api/auth/login')

    return sessionCookie.split(';')[0]!
}

/** Log in as the seeded admin user. */
export async function loginAsAdmin(): Promise<string> {
    const email = process.env.SEED_ADMIN_EMAIL
    const password = process.env.SEED_ADMIN_PASSWORD
    if (!email || !password) {
        throw new Error(
            'SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set. Add them to .env and run `battlestack db:seed`.',
        )
    }
    return loginAs(email, password)
}

/** Create a user via `POST /api/users` (admin) and log in as them. */
export async function createTestUser(
    adminCookie: string,
    overrides: Partial<{ name: string; email: string; password: string; role: string }> = {},
): Promise<TestUser> {
    const userData = {
        name: overrides.name ?? 'Test User',
        // randomUUID, not Date.now(): parallel e2e files can share a millisecond, colliding on the users_email_unique constraint (a flaky 409/500).
        email: overrides.email ?? `test-${randomUUID()}@example.com`,
        password: overrides.password ?? 'Mountain-Pine42!',
        role: overrides.role ?? 'user',
    }
    const { status, data } = await apiPost<{
        id: string
        name: string
        email: string
        role: string
    }>('/api/users', userData, adminCookie)
    if (status >= 400 || !data) {
        throw new Error(`createTestUser failed: ${status}`)
    }
    const cookie = await loginAs(userData.email, userData.password)
    return { id: data.id, name: data.name, email: data.email, role: data.role, cookie }
}

/** Returns true when `BASE_URL` answers any HTTP status. */
export async function isServerUp(): Promise<boolean> {
    try {
        await fetch(BASE_URL, { method: 'HEAD' })
        return true
    } catch {
        return false
    }
}
