import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
    hashFile,
    recordFile,
    type Feature,
    type RunContext,
    type PackageManager,
} from '@battlestack/core'
import { readJson, writeFileEnsured, writeJson } from '@battlestack/core/utils/fs.js'
import { run } from '@battlestack/core/utils/run.js'
import { templatesDir } from '@battlestack/core/utils/templates.js'
import { applyVars, renderPmVars } from '../utils/pm-template.js'
import { STAGE } from '@battlestack/core/constants/stages.js'

const FILES = ['lefthook.yml'] as const

// lefthook's own postinstall runs at scaffold time, before the project has a `.git`.
// `|| exit 0` keeps installs without a `.git` (Docker) or without dev deps from failing.
const PREPARE = 'lefthook install || exit 0'
const PREPARE_TAKEN = 'package.json has its own `prepare` script, so `lefthook install` was not added; make sure it runs it.'

/** Lefthook git hooks: pre-commit eslint. Typecheck runs in CI, not on push. */
export const ciFeature: Feature = {
    id: 'shared:ci',
    version: '1.1.2',
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
                    'CI/CD runs on GitHub Actions. Deploy pipelines and the lint/test quality gate live under `.github/workflows/` (see the GitHub Actions section).',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emit(ctx)
        await wirePrepare(ctx)
    },

    async update(ctx, _prev) {
        await emit(ctx)
        if (!await wirePrepare(ctx)) {
            return { written: [...FILES], skipped: [], notes: [PREPARE_TAKEN] }
        }
        // pull's install takes pnpm's up-to-date fast path, which skips `prepare`.
        const pm = String(ctx.state.packageManager ?? 'pnpm') as PackageManager
        await run(pm, ['run', 'prepare'], { cwd: ctx.projectDir, inherit: ctx.debug }).catch(() => {})
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

/** Adds the `prepare` hook installer. False when the project's own `prepare` is in the way. */
async function wirePrepare(ctx: RunContext): Promise<boolean> {
    const pkgPath = path.join(ctx.projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
    if (scripts.prepare) return scripts.prepare === PREPARE
    scripts.prepare = PREPARE
    pkg.scripts = scripts
    await writeJson(pkgPath, pkg)
    return true
}
