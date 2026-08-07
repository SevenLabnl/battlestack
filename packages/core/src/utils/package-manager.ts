import path from 'node:path'
import { run } from './run.js'
import { exists, readJson } from './fs.js'
import type { PackageManager } from '../types/package-manager.js'
import { BOILERPLATE_ALLOWED_BUILDS, DEFAULT_PM_PRIORITY, SUPPORTED_PMS } from '../constants/package-manager.js'

/** Shell commands installing the PM globally on a clean Node image. Unpinned. */
export function pmInstallGlobalCommands(pm: PackageManager): string[] {
    if (pm === 'npm') return []
    return [`npm install -g ${pm}`]
}

/** The package manager that invoked this process, from `npm_config_user_agent`. */
export function detectFromUserAgent(): PackageManager | null {
    const ua = process.env.npm_config_user_agent ?? ''
    if (ua.startsWith('pnpm')) return 'pnpm'
    if (ua.startsWith('bun')) return 'bun'
    if (ua.startsWith('npm')) return 'npm'
    return null
}

async function isAvailable(pm: PackageManager): Promise<boolean> {
    try {
        await run(pm, ['--version'])
        return true
    } catch {
        return false
    }
}

/** override → user agent → DEFAULT_PM_PRIORITY → npm. */
export async function resolvePackageManager(
    override?: PackageManager,
): Promise<PackageManager> {
    if (override) return override

    const fromUA = detectFromUserAgent()
    if (fromUA && (await isAvailable(fromUA))) return fromUA

    for (const pm of DEFAULT_PM_PRIORITY) {
        if (await isAvailable(pm)) return pm
    }
    return 'npm'
}

/** Args for "install dependencies". */
export function installArgs(pm: PackageManager): string[] {
    if (pm === 'pnpm') {
        // confirmModulesPurge auto-confirms the stale-node_modules prompt.
        // no-frozen-lockfile lets the lockfile absorb newly declared dependencies.
        return ['install', '--no-frozen-lockfile', '--config.confirmModulesPurge=false']
    }
    return ['install']
}

/** Args that rewrite only the lockfile to match `package.json`. */
export function lockfileSyncArgs(pm: PackageManager): string[] {
    switch (pm) {
        case 'pnpm':
            return ['install', '--lockfile-only', '--config.confirmModulesPurge=false']
        case 'npm':
            return ['install', '--package-lock-only']
        case 'bun':
            // bun has no lockfile-only flag.
            return ['install']
    }
}

/** Args for "add dependencies". */
export function addArgs(pm: PackageManager, packages: string[], dev = false): string[] {
    if (packages.length === 0) return []
    switch (pm) {
        case 'pnpm':
            return ['add', ...(dev ? ['-D'] : []), ...packages]
        case 'bun':
            return ['add', ...(dev ? ['-d'] : []), ...packages]
        case 'npm':
            return ['install', ...(dev ? ['--save-dev'] : ['--save']), ...packages]
    }
}

/** Args for "execute a one-off package" (npx / pnpm dlx / bunx). */
export function dlxArgs(pm: PackageManager, packageWithArgs: string[]): string[] {
    switch (pm) {
        case 'pnpm':
            return ['dlx', ...packageWithArgs]
        case 'bun':
            return ['x', ...packageWithArgs]
        case 'npm':
            // Caller must spawn `npx` directly.
            return packageWithArgs
    }
}

/** npm uses `npx`, others use the PM binary. */
export function dlxBinary(pm: PackageManager): string {
    return pm === 'npm' ? 'npx' : pm
}

/** Writes a seeded `pnpm-workspace.yaml` when the project has none. */
export async function ensureWorkspaceMarker(projectDir: string): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(projectDir, { recursive: true })
    const target = path.join(projectDir, 'pnpm-workspace.yaml')
    try {
        await fs.access(target)
        return
    } catch {
        // Absent.
    }
    await fs.writeFile(target, renderSeededWorkspaceYaml(), 'utf8')
}

/** Sets or replaces `minimumReleaseAge` in `pnpm-workspace.yaml`. Never hash-recorded. */
export async function writeWorkspaceReleaseAge(projectDir: string, days: number): Promise<void> {
    await ensureWorkspaceMarker(projectDir)
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const target = path.join(projectDir, 'pnpm-workspace.yaml')
    const existing = await fs.readFile(target, 'utf8')
    const minutes = days * 24 * 60
    const line = `minimumReleaseAge: ${minutes} # ${days} day(s), managed by battlestack`
    const out = /^minimumReleaseAge:.*$/m.test(existing)
        ? existing.replace(/^minimumReleaseAge:.*$/m, line)
        : existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + line + '\n'
    await fs.writeFile(target, out, 'utf8')
}

/** A fresh `pnpm-workspace.yaml` body with `allowBuilds:` pre-seeded, in `approve-builds` format. */
function renderSeededWorkspaceYaml(): string {
    const lines: string[] = ['allowBuilds:']
    for (const name of BOILERPLATE_ALLOWED_BUILDS) {
        // @-scoped names are quoted, bare names stay raw.
        const key = name.startsWith('@') ? `'${name}'` : name
        lines.push(`    ${key}: true`)
    }
    return lines.join('\n') + '\n'
}

/** Package names from a pnpm `[ERR_PNPM_IGNORED_BUILDS]` line, versions stripped and de-duped. */
export function parseIgnoredBuilds(output: string): string[] {
    const m = /Ignored build scripts:\s*([^\r\n]+)/.exec(output)
    if (!m?.[1]) return []
    const names = m[1].split(',').map((s) => {
        const trimmed = s.trim()
        // 'esbuild@0.27.7' → 'esbuild'; '@scope/pkg@1.2.3' → '@scope/pkg'
        const at = trimmed.lastIndexOf('@')
        return at > 0 ? trimmed.slice(0, at) : trimmed
    })
    return [...new Set(names.filter(Boolean))]
}

/** package.json#packageManager → fallback → pnpm. */
export async function resolveProjectPM(opts: {
    projectDir: string
    fallback?: string
}): Promise<PackageManager> {
    const fromPkg = await readPackageManagerField(opts.projectDir)
    const candidate = (fromPkg ?? opts.fallback ?? 'pnpm') as PackageManager
    const pm: PackageManager = SUPPORTED_PMS.includes(candidate) ? candidate : 'pnpm'

    if (!(await isAvailable(pm))) {
        throw new Error(
            `package.json wants ${pm} (via packageManager field) but ${pm} is `
            + `not on PATH. Install it: `
            + (pm === 'bun' ? 'https://bun.sh/' : `https://${pm}.io/`),
        )
    }
    return pm
}

async function readPackageManagerField(projectDir: string): Promise<string | null> {
    const pkgPath = path.join(projectDir, 'package.json')
    if (!(await exists(pkgPath))) return null
    try {
        const pkg = await readJson<{ packageManager?: string }>(pkgPath)
        const raw = pkg.packageManager
        if (typeof raw !== 'string' || raw.length === 0) return null
        return raw.split('@')[0] ?? null
    } catch {
        return null
    }
}
