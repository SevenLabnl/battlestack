import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import type { Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core'

/** Append-only audit trail. Best-effort on insert. */
export const auditLogFeature: Feature = {
    id: 'nuxt4:audit-log',
    version: '1.0.1',
    label: 'Audit log (security events)',
    description: 'Append-only trail of login, signup, role changes, and passkey events.',
    frameworks: ['nuxt4'],
    stage: STAGE.DATABASE,
    requires: ['nuxt4:database'],
    failureIsNonFatal: true,

    collectDocs() {
        return [
            {
                heading: 'Audit log',
                body: [
                    'Append-only `audit_events` table. Auth-relevant events (login, signup, role change, TOTP toggle, passkey register, etc.) are inserted by `server/utils/audit.ts:logAuditEvent`. Best-effort: a DB failure during audit insert is logged to `console.error` and the request proceeds normally.',
                    '',
                    '- `GET /api/audit/me`: last 50 events for the calling user (used by `/dashboard/security`)',
                    '',
                    'Query everything via `battlestack db:studio` or psql. No retention policy yet, so the table grows unbounded.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:audit-log', import.meta.url, 'audit-log')
        await flagAuditEnabled(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:audit-log', import.meta.url, 'audit-log', prev)
        await flagAuditEnabled(ctx.projectDir)
        return result
    },
}

async function flagAuditEnabled(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => c.mergeRuntimePublic({ auditLog: true }))
}
