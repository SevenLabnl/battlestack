import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs release tooling, no declaration file
import { bump, compare } from '../release-version.mjs'

describe('bump', () => {
    it.each([
        ['0.1.0', 'patch', '0.1.1'],
        ['0.1.0', 'minor', '0.2.0'],
        ['0.1.0', 'major', '1.0.0'],
        ['0.1.9', 'minor', '0.2.0'],
        ['1.2.3', 'major', '2.0.0'],
    ])('%s + %s = %s', (from, level, expected) => {
        expect(bump(from, level, 'next')).toBe(expected)
    })

    it.each([
        ['0.1.0', 'prepatch', '0.1.1-next.0'],
        ['0.1.0', 'preminor', '0.2.0-next.0'],
        ['0.1.0', 'premajor', '1.0.0-next.0'],
        ['0.1.0', 'prerelease', '0.1.1-next.0'],
        ['0.1.1-next.0', 'prerelease', '0.1.1-next.1'],
        ['0.1.1-next.9', 'prerelease', '0.1.1-next.10'],
    ])('%s + %s = %s', (from, level, expected) => {
        expect(bump(from, level, 'next')).toBe(expected)
    })

    // Graduating a prerelease keeps the number it was announced under, so
    // 0.2.0-next.3 releases as 0.2.0 rather than skipping to 0.3.0.
    it.each([
        ['0.2.0-next.3', 'minor', '0.2.0'],
        ['0.2.1-next.3', 'patch', '0.2.1'],
        ['1.0.0-next.3', 'major', '1.0.0'],
    ])('%s + %s = %s', (from, level, expected) => {
        expect(bump(from, level, 'next')).toBe(expected)
    })

    it('switching the identifier restarts the counter', () => {
        expect(bump('0.2.0-next.4', 'prerelease', 'rc')).toBe('0.2.0-rc.0')
    })

    it('carries a non-zero patch through a prerelease graduation', () => {
        expect(bump('0.2.4-next.0', 'minor', 'next')).toBe('0.3.0')
    })

    it('rejects an unknown level', () => {
        expect(() => bump('0.1.0', 'sideways', 'next')).toThrow(/invalid level/)
    })
})

describe('bump prerelease identifiers', () => {
    // The Prepare release workflow passes `--preid` straight from an
    // operator-editable text input, so an unusable value has to fail loudly
    // rather than reach package.json.
    it.each(['', 'my next', 'next.0', 'ünïcode', 'a b'])('rejects %o', (preid) => {
        expect(() => bump('0.1.0', 'preminor', preid)).toThrow(/invalid prerelease identifier/)
    })

    it.each(['next', 'rc', 'alpha-1', 'RC2', '0'])('accepts %o', (preid) => {
        expect(() => bump('0.1.0', 'preminor', preid)).not.toThrow()
    })

    it('defaults to next when omitted', () => {
        expect(bump('0.1.0', 'preminor')).toBe('0.2.0-next.0')
    })

    // A bad identifier only matters for the levels that consume one.
    it('ignores the identifier for a stable level', () => {
        expect(bump('0.1.0', 'minor', '')).toBe('0.2.0')
    })
})

describe('compare', () => {
    it.each([
        ['0.1.0', '0.1.0', 0],
        ['0.2.0', '0.1.0', 1],
        ['0.1.0', '0.2.0', -1],
        ['1.0.0', '0.9.9', 1],
        ['0.1.10', '0.1.9', 1],
        // A prerelease sorts below the release it leads to.
        ['0.2.0-next.0', '0.2.0', -1],
        ['0.2.0', '0.2.0-next.0', 1],
        ['0.2.0-next.1', '0.2.0-next.0', 1],
        ['0.2.0-next.10', '0.2.0-next.9', 1],
        // Numeric identifiers rank below alphanumeric ones, and a shorter
        // identifier list ranks below a longer one that shares its prefix.
        ['0.2.0-1', '0.2.0-alpha', -1],
        ['0.2.0-next', '0.2.0-next.0', -1],
        ['0.2.0-alpha', '0.2.0-beta', -1],
    ])('compare(%s, %s) = %i', (a, b, expected) => {
        expect(compare(a, b)).toBe(expected)
    })

    it('rejects a non-semver operand', () => {
        expect(() => compare('0.1', '0.1.0')).toThrow(/not a semver version/)
        expect(() => compare('0.1.0', '1.0.0-.0')).toThrow(/not a semver version/)
    })
})
