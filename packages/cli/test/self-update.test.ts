import { describe, expect, it } from 'vitest'
import {
    computeGatedTarget,
    decideUpdate,
    formatWindow,
    parseInstalledVersion,
    semverLt,
} from '../src/commands/self-update.js'
import type { GatedTarget } from '@battlestack/core'

const GATE_MINUTES = 1440 // pnpm 11 default: 24h

/** Registry publish times mirroring the real incident of 2026-06-05 (monolith regression fixture). */
const TIMES: Record<string, string> = {
    'created': '2024-01-01T00:00:00.000Z',
    'modified': '2026-06-05T09:28:30.902Z',
    '2.2.0': '2026-05-22T22:55:27.126Z',
    '2.2.4': '2026-05-26T12:26:59.547Z',
    '2.3.0': '2026-06-04T13:15:35.311Z',
    '2.3.1': '2026-06-04T13:30:16.489Z',
    '2.3.2': '2026-06-05T09:28:30.902Z',
    '3.0.0-beta.1': '2025-01-01T00:00:00.000Z',
}

const at = (iso: string): number => new Date(iso).getTime()

const gated = (version: string | null): GatedTarget => ({
    version,
    gateMinutes: GATE_MINUTES,
    unlocksAt: null,
})

describe('computeGatedTarget: protective window resolution', () => {
    it('picks the newest version older than the window', () => {
        // All 2.3.x are younger than 24h here: the incident where pnpm resolved
        // `latest` to 2.2.4.
        const result = computeGatedTarget('2.3.2', TIMES, GATE_MINUTES, at('2026-06-05T10:30:00Z'))
        expect(result.version).toBe('2.2.4')
    })

    it('lets a version through the moment its 24h have passed', () => {
        // 2.3.0 cleared at 13:15:35Z, 2.3.1 at 13:30:16Z.
        const between = computeGatedTarget('2.3.2', TIMES, GATE_MINUTES, at('2026-06-05T13:20:00Z'))
        expect(between.version).toBe('2.3.0')

        const after = computeGatedTarget('2.3.2', TIMES, GATE_MINUTES, at('2026-06-05T13:31:00Z'))
        expect(after.version).toBe('2.3.1')
    })

    it('resolves the true latest once it clears the window', () => {
        const result = computeGatedTarget('2.3.2', TIMES, GATE_MINUTES, at('2026-06-06T09:30:00Z'))
        expect(result.version).toBe('2.3.2')
    })

    it('a zero-minute window allows everything', () => {
        const result = computeGatedTarget('2.3.2', TIMES, 0, at('2026-06-05T09:28:31Z'))
        expect(result.version).toBe('2.3.2')
    })

    it('returns null when every release is too young', () => {
        const young: Record<string, string> = { '1.0.0': '2026-06-05T09:00:00Z' }
        const result = computeGatedTarget('1.0.0', young, GATE_MINUTES, at('2026-06-05T10:00:00Z'))
        expect(result.version).toBeNull()
    })

    it('ignores created/modified entries and prereleases', () => {
        // With no window, the prerelease is "newest" by semver; it must still never be
        // picked, nor the created/modified entries.
        const result = computeGatedTarget('2.3.2', TIMES, 0, at('2026-06-06T00:00:00Z'))
        expect(result.version).toBe('2.3.2')
    })

    it('reports when the true latest unlocks', () => {
        const result = computeGatedTarget('2.3.2', TIMES, GATE_MINUTES, at('2026-06-05T10:30:00Z'))
        expect(result.unlocksAt).not.toBeNull()
    })

    it('has no unlock time when the latest is missing from the publish times', () => {
        const result = computeGatedTarget('9.9.9', TIMES, GATE_MINUTES, at('2026-06-05T10:30:00Z'))
        expect(result.unlocksAt).toBeNull()
    })
})

describe('decideUpdate: protective window policy', () => {
    it('never downgrades when the gate resolves behind the installed version', () => {
        // The original bug: current 2.3.2, gate only allows 2.2.4.
        const decision = decideUpdate({
            currentVersion: '2.3.2',
            trueLatest: '2.3.2',
            gated: gated('2.2.4'),
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('skip')
    })

    it('flags a newer release held back by the window', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.1',
            trueLatest: '2.3.2',
            gated: gated('2.2.4'),
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('skip')
        expect(decision.heldBack).toBe(true)
    })

    it('skips quietly when truly up to date', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.2',
            trueLatest: '2.3.2',
            gated: gated('2.3.2'),
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('skip')
        expect(decision.heldBack).toBe(false)
    })

    it('upgrades to the gate-allowed version and flags the held-back newer one', () => {
        const decision = decideUpdate({
            currentVersion: '2.2.0',
            trueLatest: '2.3.2',
            gated: gated('2.2.4'),
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('install')
        expect(decision.targetVersion).toBe('2.2.4')
        expect(decision.heldBack).toBe(true)
    })

    it('upgrades cleanly once the latest clears the window', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.1',
            trueLatest: '2.3.2',
            gated: gated('2.3.2'),
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('install')
        expect(decision.targetVersion).toBe('2.3.2')
        expect(decision.heldBack).toBe(false)
    })

    it('waits when nothing passes the gate at all', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.1',
            trueLatest: '2.3.2',
            gated: gated(null),
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('skip')
        expect(decision.heldBack).toBe(true)
    })

    it('--force installs the true latest regardless of the window', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.1',
            trueLatest: '2.3.2',
            gated: null, // caller skips gating entirely under --force
            force: true,
            explicitTag: null,
        })
        expect(decision.action).toBe('install')
        expect(decision.targetVersion).toBe('2.3.2')
    })

    it('--force reinstalls even when already up to date', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.2',
            trueLatest: '2.3.2',
            gated: null,
            force: true,
            explicitTag: null,
        })
        expect(decision.action).toBe('install')
    })

    it('an explicit tag allows an intentional downgrade', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.2',
            trueLatest: '2.2.4',
            gated: null, // caller skips gating for explicit tags
            force: false,
            explicitTag: '2.2.4',
        })
        expect(decision.action).toBe('install')
        expect(decision.targetVersion).toBe('2.2.4')
    })

    it('skips an explicit tag that matches the installed version', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.2',
            trueLatest: '2.3.2',
            gated: null,
            force: false,
            explicitTag: '2.3.2',
        })
        expect(decision.action).toBe('skip')
    })

    it('npm/bun installs (no gate) go straight to the true latest', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.1',
            trueLatest: '2.3.2',
            gated: null,
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('install')
        expect(decision.targetVersion).toBe('2.3.2')
        expect(decision.heldBack).toBe(false)
    })

    it('falls back to the raw tag when the registry is unreachable', () => {
        const decision = decideUpdate({
            currentVersion: '2.3.1',
            trueLatest: null,
            gated: null,
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('install')
        expect(decision.targetVersion).toBeNull()
    })

    it('installs when the current version is unknown', () => {
        const decision = decideUpdate({
            currentVersion: 'unknown',
            trueLatest: '2.3.2',
            gated: gated('2.2.4'),
            force: false,
            explicitTag: null,
        })
        expect(decision.action).toBe('install')
        expect(decision.targetVersion).toBe('2.2.4')
    })
})

describe('formatWindow', () => {
    it('renders whole hours', () => {
        expect(formatWindow(1440)).toBe('24 hours')
        expect(formatWindow(60)).toBe('1 hour')
    })

    it('renders minutes when not a whole hour', () => {
        expect(formatWindow(90)).toBe('90 minutes')
    })
})

describe('semverLt', () => {
    it('compares major.minor.patch', () => {
        expect(semverLt('2.2.4', '2.3.0')).toBe(true)
        expect(semverLt('2.3.0', '2.2.4')).toBe(false)
        expect(semverLt('2.3.2', '2.3.2')).toBe(false)
        expect(semverLt('2.3.2', '10.0.0')).toBe(true)
    })

    it('ignores prerelease suffixes', () => {
        expect(semverLt('2.3.2-beta.1', '2.3.2')).toBe(false)
        expect(semverLt('2.3.1-rc.1', '2.3.2')).toBe(true)
    })
})

// Naming map: `@wolf/create-boilerplate` -> `battlestack` (unscoped). The fixtures below
// use the new package name throughout.
describe('parseInstalledVersion', () => {
    it('parses pnpm 11 global list JSON (array of projects)', () => {
        const stdout = JSON.stringify([{
            path: '/Users/x/Library/pnpm/global/v11',
            private: true,
            dependencies: {
                battlestack: { from: 'battlestack', version: '2.3.2' },
            },
        }])
        expect(parseInstalledVersion('pnpm', stdout)).toBe('2.3.2')
    })

    it('parses npm global ls JSON (single project object)', () => {
        const stdout = JSON.stringify({
            dependencies: { battlestack: { version: '2.3.1' } },
        })
        expect(parseInstalledVersion('npm', stdout)).toBe('2.3.1')
    })

    it('parses bun pm ls text output', () => {
        expect(parseInstalledVersion('bun', '├── battlestack@2.3.0\n')).toBe('2.3.0')
    })

    it('returns null when the package is missing', () => {
        expect(parseInstalledVersion('pnpm', JSON.stringify([{ dependencies: {} }]))).toBeNull()
    })

    it('returns null on unparseable output', () => {
        expect(parseInstalledVersion('pnpm', 'not json at all')).toBeNull()
    })
})
