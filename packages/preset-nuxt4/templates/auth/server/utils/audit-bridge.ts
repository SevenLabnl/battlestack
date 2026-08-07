import type { H3Event } from 'h3'
import { logAuditEvent } from '#server/utils/audit'

export interface TryLogAuditOptions {
    onError?: (err: Error) => void
}

/** Log an audit event when `nuxt:audit-log` is installed; no-op otherwise. */
export async function tryLogAudit(
    event: H3Event | null,
    action: string,
    userId: string | null,
    metadata?: Record<string, unknown>,
    opts?: TryLogAuditOptions,
): Promise<void> {
    if (useRuntimeConfig().public.auditLog !== true) return
    try {
        await logAuditEvent(
            event,
            action as Parameters<typeof logAuditEvent>[1],
            userId,
            metadata,
        )
    } catch (err) {
        opts?.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
}
