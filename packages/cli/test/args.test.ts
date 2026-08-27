import { describe, expect, it } from 'vitest'
import { parseArgs, stripCommandToken } from '../src/cli/args.js'

describe('parseArgs', () => {
    it('maps positionals to projectName / secondPositional / positionals', () => {
        const args = parseArgs(['my-app', 'nuxt4:rag', 'extra'])
        expect(args.projectName).toBe('my-app')
        expect(args.secondPositional).toBe('nuxt4:rag')
        expect(args.positionals).toEqual(['my-app', 'nuxt4:rag', 'extra'])
    })

    it('parses comma-separated features and disable lists', () => {
        const args = parseArgs(['--features', 'nuxt4:rag, nuxt4:pwa', '--disable', 'shared:ci'])
        expect(args.features).toEqual(['nuxt4:rag', 'nuxt4:pwa'])
        expect(args.disable).toEqual(['shared:ci'])
    })

    it('returns undefined for empty list flags', () => {
        const args = parseArgs(['--features', '  '])
        expect(args.features).toBeUndefined()
    })

    it('accepts --pm only for supported package managers', () => {
        expect(parseArgs(['--pm', 'pnpm']).packageManager).toBe('pnpm')
        expect(parseArgs(['--pm', 'yarn']).packageManager).toBeUndefined()
    })

    it('--overwrite implies force', () => {
        const args = parseArgs(['--overwrite'])
        expect(args.overwrite).toBe(true)
        expect(args.force).toBe(true)
    })

    it('--debug implies verbose; --quiet wins over both', () => {
        expect(parseArgs(['--debug']).verbose).toBe(true)
        expect(parseArgs(['--verbose']).verbose).toBe(true)
        expect(parseArgs(['--debug', '--quiet']).verbose).toBe(false)
    })

    it('-v means volumes, not version', () => {
        const args = parseArgs(['-v'])
        expect(args.volumes).toBe(true)
        expect(args.version).toBe(false)
    })

    it('gateway is tri-state', () => {
        expect(parseArgs([]).gateway).toBeUndefined()
        expect(parseArgs(['--gateway']).gateway).toBe(true)
        expect(parseArgs(['--no-gateway']).gateway).toBe(false)
    })

    it('browser defaults on; --no-browser flips it off', () => {
        expect(parseArgs([]).browser).toBe(true)
        expect(parseArgs(['--browser']).browser).toBe(true)
        expect(parseArgs(['--no-browser']).browser).toBe(false)
    })

    it('pull precision flags: skills/format default on, --no-* flip off, --skills-only opt-in', () => {
        const def = parseArgs([])
        expect(def.skills).toBe(true)
        expect(def.format).toBe(true)
        expect(def.skillsOnly).toBe(false)

        expect(parseArgs(['--no-skills']).skills).toBe(false)
        expect(parseArgs(['--no-format']).format).toBe(false)
        expect(parseArgs(['--skills-only']).skillsOnly).toBe(true)
    })

    it('forwards argv after -- as passthrough', () => {
        const args = parseArgs(['test', '--', '--coverage', '--watch'])
        expect(args.passthrough).toEqual(['--coverage', '--watch'])
    })

    it('parses the standard boolean flags', () => {
        const args = parseArgs(['--dry-run', '--skip-install', '--yes', '--deep', '--seed'])
        expect(args.dryRun).toBe(true)
        expect(args.skipInstall).toBe(true)
        expect(args.yes).toBe(true)
        expect(args.deep).toBe(true)
        expect(args.seed).toBe(true)
    })

    it('cwd only set when non-empty string', () => {
        expect(parseArgs(['--cwd', '/tmp/x']).cwd).toBe('/tmp/x')
        expect(parseArgs([]).cwd).toBeUndefined()
    })
})

describe('stripCommandToken', () => {
    it('drops a leading command token', () => {
        expect(stripCommandToken(['deploy', 'staging'])).toEqual(['staging'])
    })

    it('drops the command token, not argv[0], when a global flag comes first', () => {
        expect(stripCommandToken(['--debug', 'deploy', 'staging'])).toEqual(['--debug', 'staging'])
        expect(stripCommandToken(['-d', 'deploy', 'staging'])).toEqual(['-d', 'staging'])
    })

    it('skips past a value-taking flag and its value', () => {
        expect(stripCommandToken(['--pm', 'bun', 'deploy'])).toEqual(['--pm', 'bun'])
        expect(stripCommandToken(['-t', 'nuxt4-ai', 'deploy', 'x'])).toEqual(['-t', 'nuxt4-ai', 'x'])
        // Only a cluster's last letter takes a value.
        expect(stripCommandToken(['-dt', 'nuxt4-ai', 'deploy'])).toEqual(['-dt', 'nuxt4-ai'])
    })

    it('treats an inline flag value as self-contained', () => {
        expect(stripCommandToken(['--pm=bun', 'deploy'])).toEqual(['--pm=bun'])
        expect(stripCommandToken(['-tnuxt4-ai', 'deploy'])).toEqual(['-tnuxt4-ai'])
    })

    it('leaves argv untouched when it holds no positional', () => {
        expect(stripCommandToken(['--debug', '--pm', 'bun'])).toEqual(['--debug', '--pm', 'bun'])
        expect(stripCommandToken([])).toEqual([])
        // Everything past `--` is passthrough, never the command token.
        expect(stripCommandToken(['--', 'deploy'])).toEqual(['--', 'deploy'])
    })

    it('agrees with parseArgs on which token the command is', () => {
        for (const argv of [
            ['deploy', 'staging'],
            ['--debug', 'deploy', 'staging'],
            ['--pm', 'bun', 'deploy', 'staging'],
            ['-dt', 'nuxt4-ai', 'deploy', 'staging'],
        ]) {
            expect(parseArgs(argv).projectName).toBe('deploy')
            expect(parseArgs(stripCommandToken(argv)).projectName).toBe('staging')
        }
    })
})
