import path from 'node:path'
import pc from 'picocolors'
import { readFile } from 'node:fs/promises'
import {
    hashFile,
    readManifest,
    recordFile,
    MANIFEST_PATH,
    type Feature,
    type ProjectCommand,
    type ProjectManifest,
    type RunContext,
} from '@battlestack/core'
import { exists, writeFileEnsured } from '@battlestack/core/utils/fs.js'
import { writeWorkspaceReleaseAge } from '@battlestack/core/utils/package-manager.js'
import { RELEASE_AGE_SCAFFOLD_DAYS } from '@battlestack/core/constants/package-manager.js'
import { STAGE } from '@battlestack/core/constants/stages.js'
import { ui } from '@battlestack/tui'

/** Release-age policy ramping from 0d at scaffold to `targetDays`. State in `manifest.policies.releaseAge`. */
export const packagePolicyFeature: Feature = {
    id: 'shared:package-policy',
    version: '1.0.4',
    label: 'Supply-chain release-age policy',
    // Runs after any feature that emits .npmrc.
    stage: STAGE.ENV,

    collectDocs() {
        return [
            {
                heading: 'Supply-chain policy',
                body: [
                    'New package releases are held back before this project will install them. The hold ramps from **0 days at scaffold, through pnpm 11\'s own default (1 day) on day one, to 7 days after a week**, idempotently. Running `battlestack` (any subcommand) advances the ramp by the number of whole days elapsed since the project was created.',
                    '',
                    'Configured per-PM in this project (not your global dotfiles):',
                    '- `.npmrc`: `min-release-age` (npm 11+)',
                    '- `pnpm-workspace.yaml`: `minimumReleaseAge` in minutes (pnpm 11+)',
                    '- `bunfig.toml`: `[install] minimumReleaseAge` (bun 1.3+)',
                    '',
                    'Inspect / nudge:',
                    '',
                    '```bash',
                    'battlestack policy:status     # current days, target, days remaining',
                    'battlestack policy:tick       # force a ramp check now',
                    '```',
                    '',
                    'Bypass for a one-off install: pass the PM\'s `--no-minimum-release-age` (or equivalent).',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        const targetDays = Number(ctx.state.minReleaseAgeDays ?? 7)
        const policy = {
            startedAt: new Date().toISOString(),
            targetDays,
            // Day-0 must be 0. preCheck's ramp reaches pnpm's own default of 1d on day 1.
            currentDays: Math.min(RELEASE_AGE_SCAFFOLD_DAYS, targetDays),
        }
        const policies = ctx.state.policies ?? {}
        policies.releaseAge = policy
        ctx.state.policies = policies

        await writePolicyFiles(ctx, policy.currentDays)
    },

    async update(ctx, _prev) {
        const manifest = await readManifest(ctx.projectDir, ctx.registries)
        const days = manifest?.policies?.releaseAge?.currentDays ?? 0
        await writePolicyFiles(ctx, days)
        return {
            written: ['.npmrc / bunfig.toml'],
            skipped: [],
            notes: [],
        }
    },

    async preCheck(ctx) {
        const manifest = await readManifest(ctx.projectDir, ctx.registries)
        const policy = manifest?.policies?.releaseAge
        if (!policy) return

        const elapsed = daysBetween(new Date(policy.startedAt), new Date())
        const desired = Math.min(elapsed, policy.targetDays)
        if (desired === policy.currentDays) return

        await writePolicyFiles(ctx, desired)

        const policies = ctx.state.policies ?? manifest.policies ?? {}
        policies.releaseAge = { ...policy, currentDays: desired }
        ctx.state.policies = policies
        await persistPolicies(ctx, policies)

        const target = pc.dim(`(target ${policy.targetDays}d)`)
        ui.warn(`release-age policy ramped: ${policy.currentDays}d → ${desired}d  ${target}`)
    },

    projectCommands(): Record<string, ProjectCommand> {
        return {
            'policy:status': {
                label: 'Show release-age policy status',
                async run(ctx: RunContext) {
                    const m = await readManifest(ctx.projectDir, ctx.registries)
                    const p = m?.policies?.releaseAge
                    if (!p) {
                        ui.skip('release-age policy not installed in this project')
                        return
                    }
                    const elapsed = daysBetween(new Date(p.startedAt), new Date())
                    const remaining = Math.max(0, p.targetDays - p.currentDays)
                    ui.section('Release-age policy')
                    ui.kv([
                        ['current', `${p.currentDays}d`],
                        ['target', `${p.targetDays}d`],
                        ['elapsed', `${elapsed}d since ${p.startedAt}`],
                        ['remaining', `${remaining}d to ramp`],
                    ])
                    ui.blank()
                },
            },
            'policy:tick': {
                label: 'Force a release-age ramp check',
                async run(ctx: RunContext) {
                    await packagePolicyFeature.preCheck!(ctx)
                    ui.ok('Done')
                },
            },
        }
    },
}

function daysBetween(a: Date, b: Date): number {
    return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000))
}

async function persistPolicies(
    ctx: RunContext,
    policies: ProjectManifest['policies'],
): Promise<void> {
    const target = path.join(ctx.projectDir, MANIFEST_PATH)
    if (!(await exists(target))) return
    const raw = JSON.parse(await readFile(target, 'utf8')) as ProjectManifest
    raw.policies = policies
    raw.updatedAt = new Date().toISOString()
    await writeFileEnsured(target, JSON.stringify(raw, null, 4) + '\n')
}

async function writePolicyFiles(ctx: RunContext, days: number): Promise<void> {
    const pm = String(ctx.state.packageManager ?? 'pnpm')
    if (pm === 'npm' || pm === 'pnpm') {
        await writeNpmrc(ctx, days)
    }
    if (pm === 'pnpm') {
        await writePnpmWorkspacePolicy(ctx, days)
    }
    if (pm === 'bun') {
        await writeBunfig(ctx, days)
    }
}

async function writePnpmWorkspacePolicy(ctx: RunContext, days: number): Promise<void> {
    await writeWorkspaceReleaseAge(ctx.projectDir, days)
}

const NPMRC_HEADER = '# Supply-chain policy (managed by @battlestack/preset-nuxt)'

async function writeNpmrc(
    ctx: RunContext,
    days: number,
): Promise<void> {
    const target = path.join(ctx.projectDir, '.npmrc')
    const existing = (await exists(target)) ? await readFile(target, 'utf8') : ''

    // Strips our previous block, between the header and the next blank line.
    const lines = existing.split(/\r?\n/)
    const out: string[] = []
    let inBlock = false
    for (const line of lines) {
        if (line.trim() === NPMRC_HEADER) {
            inBlock = true
            continue
        }
        if (inBlock) {
            if (line.trim() === '') {
                inBlock = false
            }
            continue
        }
        out.push(line)
    }

    while (out.length > 0 && out.at(-1)!.trim() === '') out.pop()

    // pnpm is absent here: pnpm 11 ignores `.npmrc` for this setting.
    const block: string[] = [
        '',
        NPMRC_HEADER,
        '# npm 11+',
        // npm's `min-release-age` is a bare whole-day Number. Never an `Nd` suffix.
        `min-release-age=${days}`,
    ]

    const final = [...out, ...block, ''].join('\n')
    await writeFileEnsured(target, final)
    recordFile(ctx, 'shared:package-policy', '.npmrc', await hashFile(target))
}

async function writeBunfig(ctx: RunContext, days: number): Promise<void> {
    const target = path.join(ctx.projectDir, 'bunfig.toml')
    const existing = (await exists(target)) ? await readFile(target, 'utf8') : ''
    const seconds = days * 24 * 60 * 60

    let out = existing
    if (/^minimumReleaseAge\s*=/m.test(out)) {
        out = out.replace(
            /^minimumReleaseAge\s*=.*/m,
            `minimumReleaseAge = ${seconds}  # ${days} days (managed by @battlestack/preset-nuxt)`,
        )
    } else {
        if (!out.includes('[install]')) {
            out += (out && !out.endsWith('\n') ? '\n' : '') + '\n[install]\n'
        }
        out
            += `minimumReleaseAge = ${seconds}  # ${days} days (managed by @battlestack/preset-nuxt)\n`
    }
    await writeFileEnsured(target, out)
    recordFile(ctx, 'shared:package-policy', 'bunfig.toml', await hashFile(target))
}
