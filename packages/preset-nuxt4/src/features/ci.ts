import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
    hashFile,
    recordFile,
    type Feature,
    type RunContext,
    type PackageManager,
} from '@battlestack/core'
import { writeFileEnsured } from '@battlestack/core/utils/fs.js'
import { templatesDir } from '@battlestack/core/utils/templates.js'
import { applyVars, renderPmVars } from '../utils/pm-template.js'
import { STAGE } from '@battlestack/core/constants/stages.js'

const FILES = ['lefthook.yml'] as const

/** Lefthook git hooks: pre-commit eslint. Typecheck runs in CI, not on push. */
export const ciFeature: Feature = {
    id: 'shared:ci',
    // 1.1.0: dropped the Prettier pre-commit hook.
    version: '1.1.0',
    label: 'Git hooks (lefthook)',
    description: 'Pre-commit eslint on staged files via lefthook.',
    stage: STAGE.GITIGNORE,
    failureIsNonFatal: true,

    collectDeps() {
        return { dev: ['lefthook', 'vue-tsc'] }
    },

    collectDocs() {
        return [
            {
                heading: 'Git hooks',
                body: [
                    'Lefthook at `lefthook.yml` wires pre-commit (eslint on staged files). Install hooks once: `lefthook install`. Typecheck (`nuxi typecheck`) runs in CI rather than on push to keep local cycles fast.',
                    '',
                    'CI/CD runs on GitHub Actions. Deploy pipelines and the lint/test/SonarQube quality gate live under `.github/workflows/` (see the GitHub Actions section).',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emit(ctx)
    },

    async update(ctx, _prev) {
        await emit(ctx)
        return { written: [...FILES], skipped: [], notes: [] }
    },
}

async function emit(ctx: RunContext): Promise<void> {
    const pm = String(ctx.state.packageManager ?? 'pnpm') as PackageManager
    const vars = renderPmVars(pm)
    const src = templatesDir(import.meta.url, '..', '..', 'templates', 'ci')

    for (const rel of FILES) {
        const raw = await readFile(path.join(src, rel), 'utf8')
        const out = applyVars(raw, vars)
        const dest = path.join(ctx.projectDir, rel)
        await writeFileEnsured(dest, out)
        recordFile(ctx, 'shared:ci', rel, await hashFile(dest))
    }
}
