import path from 'node:path'
import {
    readJson,
    writeJson,
    allocatePort,
    run,
    resolveProjectPM,
    CLIError,
    ErrorCode,
    STAGE,
    type Feature,
    type ProjectCommand,
    type RunContext,
} from '@battlestack/core'
import { readDotEnv } from '@battlestack/core/utils/dotenv.js'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { ui } from '@battlestack/tui'

/** Vitest config, a sample unit test and `test` scripts. Three projects: unit, nuxt, e2e. */
export const vitestFeature: Feature = {
    id: 'nuxt4:vitest',
    version: '1.0.5',
    label: 'Vitest config + scripts',
    frameworks: ['nuxt4'],
    stage: STAGE.NAMING, // run after naming so package.json exists

    collectDeps() {
        return {
            dev: [
                'vitest',
                '@vitest/coverage-v8',
                '@nuxt/test-utils',
                '@vue/test-utils',
                'happy-dom',
            ],
        }
    },

    collectDocs() {
        return [
            {
                heading: 'Testing',
                body: [
                    'Vitest with three project layout (`unit`, `nuxt`, `e2e`) per the Nuxt testing docs.',
                    '',
                    '- `test/unit/`: node env, pure logic',
                    '- `test/nuxt/`: Nuxt env (happy-dom), components + auto-imports',
                    '- `test/e2e/`: hits a live dev server (`await setup({ server: true })`)',
                    '',
                    'Run: `battlestack test`. It probes `/api/health` first and warns if `battlestack dev` isn\'t running (the e2e suite needs a live server, otherwise every e2e block self-skips). Pass extra flags after `--`: `battlestack test -- --coverage` / `battlestack test -- --watch`. Use `pnpm test` directly if you want to skip the guard.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:vitest', import.meta.url, 'vitest')
        await wireScripts(ctx)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, 'nuxt4:vitest', import.meta.url, 'vitest', prev)
        await wireScripts(ctx)
        return report
    },

    projectCommands(): Record<string, ProjectCommand> {
        return {
            test: {
                label: 'Run vitest (warns when dev server isn\'t up, since e2e tests need it)',
                description: 'Probes /api/health before delegating to `pnpm test`. Pass `--force` to run regardless. Pass extra args after `--` to forward to vitest (e.g. `battlestack test -- --coverage`).',
                run: runTest,
            },
        }
    },
}

async function runTest(ctx: RunContext): Promise<void> {
    const env = await readDotEnv(ctx.projectDir)
    const port = env.get('NUXT_PORT') || String(allocatePort(ctx.projectName, 'app'))
    const baseUrl = `http://localhost:${port}`
    const force = ctx.state.force === true

    const up = await isDevServerUp(baseUrl)
    if (!up && !force) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Dev server not reachable at ${baseUrl}. Start it in another terminal with \`battlestack dev\`, then re-run \`battlestack test\`. Pass \`--force\` to run anyway (e2e tests will skip themselves).`,
        )
    }
    if (!up && force) {
        ui.warn(`Dev server not reachable at ${baseUrl}. Running anyway (e2e tests will skip themselves).`)
    } else {
        ui.dim(`Dev server reachable at ${baseUrl}`)
    }

    const pm = await resolveProjectPM({
        projectDir: ctx.projectDir,
        fallback: String(ctx.state.packageManager ?? 'pnpm'),
    })
    const passthrough = ctx.state.passthrough ?? []
    await run(pm, ['run', 'test', ...passthrough], { cwd: ctx.projectDir, inherit: true })
}

async function isDevServerUp(baseUrl: string): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    try {
        const res = await fetch(`${baseUrl}/`, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'manual',
        })
        return res.status > 0
    } catch {
        return false
    } finally {
        clearTimeout(timer)
    }
}

async function wireScripts(ctx: RunContext): Promise<void> {
    const pkgPath = path.join(ctx.projectDir, 'package.json')
    const pkg = await readJson<Record<string, unknown>>(pkgPath)
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
    scripts.test = 'vitest run'
    scripts['test:watch'] = 'vitest'
    scripts['test:coverage'] = 'vitest run --coverage'
    pkg.scripts = scripts
    await writeJson(pkgPath, pkg)
}
