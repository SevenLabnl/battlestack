import path from 'node:path'
import { type Feature, type RunContext, type UpdateReport } from '@battlestack/core'
import { readJson, writeJson } from '@battlestack/core/utils/fs.js'
import { copyTemplateDirRecorded, templatesDir, updateFromTemplateDir } from '@battlestack/core/utils/templates.js'
import { STAGE } from '@battlestack/core/constants/stages.js'

/** Shared formatting files: `.editorconfig`, `.dockerignore`. Always-on. No Prettier. */
export const formattingFeature: Feature = {
    id: 'shared:formatting',
    // 1.1.0: dropped Prettier. `format` and `format:check` now run ESLint.
    version: '1.1.0',
    label: 'Formatting + .dockerignore',
    stage: STAGE.GITIGNORE,

    async execute(ctx) {
        const src = templatesDir(import.meta.url, '..', '..', 'templates', 'formatting')
        await copyTemplateDirRecorded(ctx, 'shared:formatting', src)
        await wireScripts(ctx)
    },

    async update(ctx, prev): Promise<UpdateReport> {
        const src = templatesDir(import.meta.url, '..', '..', 'templates', 'formatting')
        const report = await updateFromTemplateDir(ctx, 'shared:formatting', src, prev)
        await wireScripts(ctx)
        return report
    },
}

async function wireScripts(ctx: RunContext): Promise<void> {
    const pkgPath = path.join(ctx.projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
    // The same tool as `lint`/`lint:fix`. The CI workflow, lefthook hook and docs use `format:check`.
    scripts.format = 'eslint . --fix'
    scripts['format:check'] = 'eslint .'
    pkg.scripts = scripts
    await writeJson(pkgPath, pkg)
}
