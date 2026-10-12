import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import type { Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core'

/** Admin-gated user CRUD + admin pages + admin route middleware. */
export const userAdminFeature: Feature = {
    id: 'nuxt4:user-admin',
    version: '1.0.5',
    label: 'User administration (admin-gated CRUD)',
    description: 'Admin-only /dashboard/users for listing, creating, editing, and deleting users.',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH_EXTRAS,
    requires: ['nuxt4:auth', 'nuxt4:audit-log'],
    failureIsNonFatal: true,

    collectDocs() {
        return [
            {
                heading: 'User admin',
                body: [
                    'Admin-only `/dashboard/users` for listing, creating, editing, and deleting users. Role-gated by `requireRole(event, Role.Admin)` server-side and `app/middleware/admin.ts` client-side.',
                    '',
                    '- `GET /api/users` (admin): list with optional `?search=`',
                    '- `POST /api/users` (admin): create',
                    '- `GET /api/users/[id]` (admin or self): read',
                    '- `PUT /api/users/[id]` (admin or self; only admins may change `role`)',
                    '- `DELETE /api/users/[id]` (admin only; refuses to delete self)',
                    '',
                    'Bootstrap an admin via `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` in `.env`, then `battlestack db:seed`.',
                    '',
                    'Create and edit forms explain the email format and password requirements, validate while typing and before submission, and show field-specific errors in Dutch or English. Email syntax follows the same Zod validator as the API; format validation does not verify mailbox existence.',
                    '',
                    'A new user needs a password that passes `shared/utils/password-policy.ts`. An empty password on the edit form leaves the existing password unchanged; a nonempty replacement must pass the same policy. Direct API requests remain validated independently, and an explicitly empty API password is rejected.',
                    '',
                    'Server failures use `serverErrorMessage` so the API response explanation is visible instead of a generic HTTP error. Permission checks and duplicate-email handling remain server-side. Form regressions run in the generated `test/nuxt/` project without a database or a running dev server.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:user-admin', import.meta.url, 'user-admin')
        await flagUserAdminEnabled(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:user-admin', import.meta.url, 'user-admin', prev)
        await flagUserAdminEnabled(ctx.projectDir)
        return result
    },
}

// Runtime flag gating the dashboard-shell layout's "Users" sidebar entry.
async function flagUserAdminEnabled(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => c.mergeRuntimePublic({ userAdmin: true }))
}
