import path from 'node:path'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { exists, resolveSpawn, updateLedger, type RunContext } from '@battlestack/core'
import { ui } from '@battlestack/tui'

const execFileAsync = promisify(execFile)

/** Set when the lockfile breaks the release-age policy, so nothing that runs pnpm is tried. */
export const LOCKFILE_BLOCKED_STATE_KEY = 'pull:lockfileBlocked'

const REBUILD = '`pnpm clean --lockfile && pnpm install`'

export async function hasReleaseAgePolicy(projectDir: string): Promise<boolean> {
    const file = path.join(projectDir, 'pnpm-workspace.yaml')
    if (!(await exists(file))) return false
    return /^minimumReleaseAge:/m.test(await readFile(file, 'utf8'))
}

/**
 * A lockfile resolved before the release-age policy can hold packages younger than it allows,
 * and pnpm then refuses every `pnpm run`. `--lockfile-only` checks that without touching
 * node_modules. Records the step to take and returns true when the lockfile is rejected.
 */
export async function checkLockfileAgainstReleaseAge(ctx: RunContext): Promise<boolean> {
    if (String(ctx.state.packageManager ?? 'pnpm') !== 'pnpm') return false
    if (!(await exists(path.join(ctx.projectDir, 'pnpm-lock.yaml')))) return false
    if (!(await hasReleaseAgePolicy(ctx.projectDir))) return false
    let output = ''
    try {
        // Resolved, so Windows finds `pnpm.cmd`.
        const pnpm = resolveSpawn('pnpm', ['install', '--frozen-lockfile', '--lockfile-only'], { cwd: ctx.projectDir })
        await execFileAsync(pnpm.file, pnpm.args, {
            cwd: ctx.projectDir,
            env: { ...process.env, CI: 'true' },
            maxBuffer: 16 * 1024 * 1024,
            shell: pnpm.shell,
            windowsVerbatimArguments: pnpm.windowsVerbatimArguments,
        })
        return false
    } catch (err) {
        const e = err as { stdout?: string, stderr?: string, message?: string }
        output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim() || (e.message ?? '')
    }
    if (!/ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION/.test(output)) {
        // Offline, or a lockfile behind package.json: the check says nothing either way.
        const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        const reason = lines.findLast((l) => l.includes('ERR_PNPM')) ?? lines.at(-1)
        ui.warn(`Could not check pnpm-lock.yaml against the release-age policy${reason ? ` (${reason})` : ''}. If pnpm later refuses with ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION, rebuild it with ${REBUILD}`)
        return false
    }
    ctx.state[LOCKFILE_BLOCKED_STATE_KEY] = true
    updateLedger(ctx).actions.push(
        `\`pnpm-lock.yaml\` predates the 3-day release-age policy this pull added, and holds packages younger than it allows, so pnpm refuses to run scripts. Rebuild it with ${REBUILD}, then run \`pnpm run lint:fix\` and the tests. The rebuild can change resolved versions: review the lockfile diff.`,
    )
    ui.warn(`pnpm-lock.yaml breaks the new release-age policy, so lint and db:generate were skipped. See .battlestack/pull/REPORT.md`)
    return true
}
