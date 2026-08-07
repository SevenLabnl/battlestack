import { describe, expect, it, afterAll } from 'vitest'
import { addArgs, detectFromUserAgent, dlxArgs, dlxBinary, installArgs } from '../src/utils/package-manager.js'

describe('detectFromUserAgent', () => {
    const original = process.env.npm_config_user_agent

    it('returns null without ua', () => {
        delete process.env.npm_config_user_agent
        expect(detectFromUserAgent()).toBeNull()
    })

    it.each([
        ['pnpm/9.0.0 ...', 'pnpm'],
        ['bun/1.3.0', 'bun'],
        ['npm/10.0.0', 'npm'],
    ])('detects %s', (ua, expected) => {
        process.env.npm_config_user_agent = ua
        expect(detectFromUserAgent()).toBe(expected)
    })

    afterAll(() => {
        if (original) process.env.npm_config_user_agent = original
        else delete process.env.npm_config_user_agent
    })
})

describe('installArgs', () => {
    it.each([
        // pnpm auto-confirms the node_modules purge prompt; our spawns are piped, so
        // the interactive prompt would abort the install.
        ['pnpm', ['install', '--no-frozen-lockfile', '--config.confirmModulesPurge=false']],
        ['bun', ['install']],
        ['npm', ['install']],
    ] as const)('%s', (pm, expected) => {
        expect(installArgs(pm)).toEqual(expected)
    })

    // pnpm turns frozen-lockfile on whenever CI is set, which rejects the install
    // that scaffold and `add` perform right after declaring new dependencies.
    it('opts pnpm out of the CI frozen-lockfile default', () => {
        expect(installArgs('pnpm')).toContain('--no-frozen-lockfile')
    })

    // npm has no such default, and bun was verified not to apply one either.
    it.each(['npm', 'bun'] as const)('leaves %s untouched', (pm) => {
        expect(installArgs(pm)).not.toContain('--no-frozen-lockfile')
    })
})

describe('addArgs', () => {
    it('returns empty array when no packages', () => {
        expect(addArgs('pnpm', [])).toEqual([])
    })

    it.each([
        ['pnpm', false, ['add', 'lodash']],
        ['pnpm', true, ['add', '-D', 'lodash']],
        ['bun', true, ['add', '-d', 'lodash']],
        ['npm', false, ['install', '--save', 'lodash']],
        ['npm', true, ['install', '--save-dev', 'lodash']],
    ] as const)('%s dev=%s', (pm, dev, expected) => {
        expect(addArgs(pm, ['lodash'], dev)).toEqual(expected)
    })
})

describe('dlxArgs / dlxBinary', () => {
    it('pnpm uses dlx subcommand', () => {
        expect(dlxBinary('pnpm')).toBe('pnpm')
        expect(dlxArgs('pnpm', ['nuxi@latest'])).toEqual(['dlx', 'nuxi@latest'])
    })

    it('bun uses x subcommand', () => {
        expect(dlxBinary('bun')).toBe('bun')
        expect(dlxArgs('bun', ['nuxi@latest'])).toEqual(['x', 'nuxi@latest'])
    })

    it('npm requires npx binary', () => {
        expect(dlxBinary('npm')).toBe('npx')
        expect(dlxArgs('npm', ['nuxi@latest'])).toEqual(['nuxi@latest'])
    })
})
