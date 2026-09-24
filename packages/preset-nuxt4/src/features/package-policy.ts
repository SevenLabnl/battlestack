import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { hashFile, readManifest, recordFile, type Feature, type RunContext } from '@battlestack/core'
import { exists, writeFileEnsured } from '@battlestack/core/utils/fs.js'
import { writeWorkspaceReleaseAge } from '@battlestack/core/utils/package-manager.js'
import { RELEASE_AGE_DAYS } from '@battlestack/core/constants/package-manager.js'
import { STAGE } from '@battlestack/core/constants/stages.js'

/** A fixed release-age hold for every package manager the project may use. */
export const packagePolicyFeature: Feature = {
    id: 'shared:package-policy',
    version: '2.0.0',
    label: 'Supply-chain release-age policy',
    // Runs after any feature that emits .npmrc.
    stage: STAGE.ENV,

    collectDocs() {
        return [
            {
                heading: 'Supply-chain policy',
                body: [
                    `New package releases are held back for **${RELEASE_AGE_DAYS} days** before this project installs them. When nothing older satisfies a range, pnpm still installs the newer release rather than failing.`,
                    '',
                    'Configured per package manager in this project, not in your global dotfiles:',
                    '- `pnpm-workspace.yaml`: `minimumReleaseAge` in minutes, with `minimumReleaseAgeStrict: false`',
                    '- `.npmrc`: `min-release-age` in days (npm)',
                    '- `bunfig.toml`: `[install] minimumReleaseAge` in seconds (bun)',
                    '',
                    'Bypass for a one-off install: pass the package manager\'s `--no-minimum-release-age` (or equivalent).',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await writePolicyFiles(ctx)
    },

    async update(ctx) {
        // Drops the ramp state 1.x kept in the manifest, which is carried forward unless replaced.
        const policies = ctx.state.policies ?? (await readManifest(ctx.projectDir, ctx.registries))?.policies
        if (policies && 'releaseAge' in policies) {
            const { releaseAge: _dropped, ...rest } = policies
            ctx.state.policies = rest
        }
        await writePolicyFiles(ctx)
        return {
            written: ['.npmrc / pnpm-workspace.yaml / bunfig.toml'],
            skipped: [],
            notes: [],
        }
    },
}

async function writePolicyFiles(ctx: RunContext): Promise<void> {
    const pm = String(ctx.state.packageManager ?? 'pnpm')
    if (pm === 'npm' || pm === 'pnpm') await writeNpmrc(ctx)
    if (pm === 'pnpm') await writeWorkspaceReleaseAge(ctx.projectDir, RELEASE_AGE_DAYS)
    if (pm === 'bun') await writeBunfig(ctx)
}

const NPMRC_HEADER = '# Supply-chain policy (managed by @battlestack/preset-nuxt)'

async function writeNpmrc(ctx: RunContext): Promise<void> {
    const target = path.join(ctx.projectDir, '.npmrc')
    const existing = (await exists(target)) ? await readFile(target, 'utf8') : ''

    // Strips our previous block, between the header and the next blank line.
    const out: string[] = []
    let inBlock = false
    for (const line of existing.split(/\r?\n/)) {
        if (line.trim() === NPMRC_HEADER) {
            inBlock = true
            continue
        }
        if (inBlock) {
            if (line.trim() === '') inBlock = false
            continue
        }
        out.push(line)
    }
    while (out.length > 0 && out.at(-1)!.trim() === '') out.pop()

    // pnpm reads this setting from `pnpm-workspace.yaml` only; the block is for npm.
    const block = [
        '',
        NPMRC_HEADER,
        // npm's `min-release-age` is a bare whole-day number, never an `Nd` suffix.
        `min-release-age=${RELEASE_AGE_DAYS}`,
    ]
    await writeFileEnsured(target, [...out, ...block, ''].join('\n'))
    recordFile(ctx, 'shared:package-policy', '.npmrc', await hashFile(target))
}

async function writeBunfig(ctx: RunContext): Promise<void> {
    const target = path.join(ctx.projectDir, 'bunfig.toml')
    const existing = (await exists(target)) ? await readFile(target, 'utf8') : ''
    const line = `minimumReleaseAge = ${RELEASE_AGE_DAYS * 24 * 60 * 60}  # ${RELEASE_AGE_DAYS} days (managed by @battlestack/preset-nuxt)`

    let out = existing
    if (/^minimumReleaseAge\s*=/m.test(out)) {
        out = out.replace(/^minimumReleaseAge\s*=.*/m, line)
    } else {
        if (!out.includes('[install]')) out += (out && !out.endsWith('\n') ? '\n' : '') + '\n[install]\n'
        out += line + '\n'
    }
    await writeFileEnsured(target, out)
    recordFile(ctx, 'shared:package-policy', 'bunfig.toml', await hashFile(target))
}
