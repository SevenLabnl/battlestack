import minimist from 'minimist'
import { SUPPORTED_PMS, type PackageManager, type ParsedArgs } from '@battlestack/core'

/** Flags whose value is the next argv token, so `--pm bun` never reads `bun` as a positional. */
const STRING_FLAGS = ['framework', 'template', 'features', 'disable', 'pm', 'package-manager', 'cwd']

// -v is --volumes, not --version.
const ALIASES: Record<string, string> = {
    f: 'framework',
    t: 'template',
    h: 'help',
    d: 'debug',
    y: 'yes',
    v: 'volumes',
    V: 'verbose',
    q: 'quiet',
}

const VALUE_FLAGS: ReadonlySet<string> = new Set([
    ...STRING_FLAGS,
    ...Object.keys(ALIASES).filter((short) => STRING_FLAGS.includes(ALIASES[short]!)),
])

export function parseArgs(argv: string[]): ParsedArgs {
    const raw = minimist(argv, {
        'string': STRING_FLAGS,
        'boolean': [
            'debug',
            'dry-run',
            'help',
            'version',
            'skip-install',
            'force',
            'overwrite',
            'yes',
            'scaffold',
            'seed',
            'deep',
            'volumes',
            'verbose',
            'quiet',
            'browser',
            // `pull` precision toggles.
            'skills',
            'format',
            'skills-only',
        ],
        'alias': ALIASES,
        // `--no-*` flips these to false. Everything else in `boolean` defaults off.
        'default': { browser: true, skills: true, format: true },
        // Argv after `--` lands in `raw['--']`.
        '--': true,
    })

    const positional = raw._.filter((v): v is string => typeof v === 'string')
    const pm = (raw.pm || raw['package-manager']) as string | undefined

    return {
        projectName: positional[0],
        secondPositional: positional[1],
        positionals: positional,
        framework: raw.framework,
        template: raw.template,
        features: parseList(raw.features),
        disable: parseList(raw.disable),
        packageManager: isPM(pm) ? pm : undefined,
        cwd: typeof raw.cwd === 'string' && raw.cwd.length > 0 ? raw.cwd : undefined,
        force: Boolean(raw.force) || Boolean(raw.overwrite),
        overwrite: Boolean(raw.overwrite),
        yes: Boolean(raw.yes),
        skipInstall: Boolean(raw['skip-install']),
        debug: Boolean(raw.debug) || process.env.DEBUG === 'true',
        dryRun: Boolean(raw['dry-run']),
        help: Boolean(raw.help),
        version: Boolean(raw.version),
        scaffold: Boolean(raw.scaffold),
        seed: Boolean(raw.seed),
        deep: Boolean(raw.deep),
        // `--debug` implies verbose. `--quiet` forces it off.
        verbose: (Boolean(raw.verbose) || Boolean(raw.debug)) && !raw.quiet,
        gateway: parseGatewayFlag(argv),
        volumes: Boolean(raw.volumes),
        browser: Boolean(raw.browser),
        skills: raw.skills !== false,
        format: raw.format !== false,
        skillsOnly: Boolean(raw['skills-only']),
        passthrough: (raw['--'] as string[] | undefined) ?? [],
    }
}

function parseGatewayFlag(argv: string[]): boolean | undefined {
    if (argv.includes('--no-gateway')) return false
    if (argv.includes('--gateway')) return true
    return undefined
}

function parseList(value: unknown): string[] | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined
    return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
}

function isPM(value: string | undefined): value is PackageManager {
    return !!value && (SUPPORTED_PMS as string[]).includes(value)
}

/**
 * `argv` minus the command token. That token is the first positional, not
 * necessarily `argv[0]`: `--debug deploy staging` forwards `['--debug', 'staging']`
 * so a plugin command sees `staging` as its own first positional.
 */
export function stripCommandToken(argv: string[]): string[] {
    const index = commandTokenIndex(argv)
    if (index < 0) return [...argv]
    return [...argv.slice(0, index), ...argv.slice(index + 1)]
}

/** -1 when `argv` has no positional at all. */
function commandTokenIndex(argv: string[]): number {
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!
        // Everything past `--` is passthrough, never a positional.
        if (token === '--') return -1
        if (token.startsWith('--')) {
            const name = token.slice(2)
            if (!name.includes('=') && VALUE_FLAGS.has(name)) i++
            continue
        }
        if (token.startsWith('-') && token.length > 1) {
            // Only a cluster's last letter can take a value: `-dt nuxt4-ai`, but not `-tnuxt4-ai`.
            const letters = token.slice(1)
            if (!letters.includes('=') && VALUE_FLAGS.has(letters.slice(-1))) i++
            continue
        }
        return i
    }
    return -1
}
