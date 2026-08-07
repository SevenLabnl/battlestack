import type { H3Event } from 'h3'
import { getRequestIP, getRequestHeader } from 'h3'
import { db } from '#server/database/client'
import { auditEvents } from '#server/database/schema/audit-log'

export type AuditAction =
    | 'user.login.success'
    | 'user.login.fail'
    | 'user.logout'
    | 'user.signup'
    | 'user.deleted'
    | 'user.role.changed'
    | 'user.email.changed'
    | 'user.password.changed'
    | 'user.email.verified'
    | 'user.email.verification.resent'
    | 'user.password.reset.requested'
    | 'user.password.reset.completed'
    | 'user.totp.enabled'
    | 'user.totp.disabled'
    | 'user.backup-codes.generated'
    | 'user.backup-codes.redeemed'
    | 'user.backup-codes.redeem-failed'
    | 'user.passkey.registered'
    | 'user.passkey.removed'
    | 'user.passkey.login'
    | 'user.session.revoked'
    | 'auth.oauth.signin'
    | 'prompt.updated'
    | 'prompt.reset'
    | 'ai.model-config.updated'
    | 'file.uploaded'
    | 'file.deleted'

/** Best-effort audit insert; logs to console on failure. */
export async function logAuditEvent(
    event: H3Event | null,
    action: AuditAction,
    userId: string | null,
    metadata?: Record<string, unknown>,
): Promise<void> {
    try {
        await db.insert(auditEvents).values({
            userId,
            action,
            ip: event ? (getRequestIP(event, { xForwardedFor: true }) ?? null) : null,
            userAgent: event ? (getRequestHeader(event, 'user-agent') ?? null) : null,
            metadata: metadata ? JSON.stringify(metadata) : null,
        })
    } catch (err) {
        console.error('[audit] failed to log event', action, err)
    }
}
