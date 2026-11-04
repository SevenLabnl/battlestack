import type { H3Event } from 'h3'
import type { RequestEvent } from 'nuxt/server'
import { db } from '#server/database/client'
import type { Role } from '#server/database/schema/users'
import { sessions } from '#server/database/schema/sessions'

export interface SessionUser {
    id: string
    email: string
    name?: string
    role?: Role
    theme?: string
    locale?: string
}

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** The h3 event behind the `RequestEvent` that nuxt-auth-utils passes to OAuth and WebAuthn callbacks. */
export function toH3Event(event: H3Event | RequestEvent): H3Event {
    // On Nuxt 4 a `RequestEvent` is a proxy over the h3 event, so h3's helpers read it as is.
    return event as unknown as H3Event
}

/** Create a server-side session row and return its id. */
export async function createDbSession(userId: string, event: H3Event | RequestEvent): Promise<string> {
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS)
    const userAgent = getRequestHeader(toH3Event(event), 'user-agent') ?? null
    const ip = getRequestIP(toH3Event(event), { xForwardedFor: true }) ?? null
    const [row] = await db
        .insert(sessions)
        .values({ userId, expiresAt, userAgent, ip })
        .returning({ id: sessions.id })
    if (!row) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create session' })
    }
    return row.id
}

/** Require an authenticated user with one of the given roles. Throws 401/403. */
export async function requireRole(event: H3Event, ...roles: Role[]) {
    const session = await requireUserSession(event)
    if (!session.user.role || !roles.includes(session.user.role as Role)) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Insufficient permissions',
        })
    }
    return session
}

/** Read a required router param, throwing 400 when missing. */
export function requireRouterParam(event: H3Event, name: string): string {
    const value = getRouterParam(event, name)
    if (!value) {
        throw createError({ statusCode: 400, statusMessage: `Missing ${name}` })
    }
    return value
}
