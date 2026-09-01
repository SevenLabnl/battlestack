import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { STAGE } from '@battlestack/core'
import type { Feature } from '@battlestack/core'

/** Admin-editable AI agent prompts. */
export const promptsFeature: Feature = {
    id: 'nuxt4:prompts',
    version: '1.2.0',
    label: 'AI prompt management',
    description: 'Admin-editable agent prompts with shipped registry defaults.',
    frameworks: ['nuxt4'],
    stage: STAGE.AI_CORE,
    requires: ['nuxt4:mastra', 'nuxt4:user-admin', 'nuxt4:audit-log'],
    failureIsNonFatal: true,

    collectDocs() {
        return [
            {
                heading: 'Prompt management',
                body: [
                    'Admin-editable AI agent prompts. Default prompts live in `server/utils/prompts/defaults.ts` (shipped by `nuxt4:mastra`); the `prompts` table is populated from that registry both on `battlestack db:seed` AND on every boot via `server/plugins/11-sync-prompts-on-boot.ts` (insert-if-missing, refreshes `default_content`, never overwrites admin-edited `content`). So staging/prod deploys get prompts without the dev-only seed.',
                    '',
                    'Admins edit live content at `/dashboard/prompts`. Reset restores a row\'s `defaultContent`. Agents look up prompts via `getPromptByKey(key)` (or, when linked through the `agents` table, `getAgentInstructions(agentKey)`), both falling back to the registry default when the table is empty.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:prompts', import.meta.url, 'prompts')
        await flagPromptMgmt(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:prompts', import.meta.url, 'prompts', prev)
        await flagPromptMgmt(ctx.projectDir)
        return result
    },
}

async function flagPromptMgmt(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => c.mergeRuntimePublic({ promptMgmt: true }))
}
