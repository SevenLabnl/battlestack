import { describe, expect, it } from 'vitest'
import { versionStatus } from '../version-status'

describe('versionStatus', () => {
    it.each([
        [null, '1.0.0', 'new'],
        ['1.5.3', '1.5.3', 'same'],
        ['1.5.3', '1.5.4', 'bumped'],
        ['1.5.3', '1.6.0', 'bumped'],
        ['1.9.9', '2.0.0', 'bumped'],
        ['1.5.10', '1.5.9', 'lowered'],
        ['1.5.3', '1.5.2', 'lowered'],
        ['2.0.0', '1.9.9', 'lowered'],
    ])('base %s, now %s: %s', (base, version, expected) => {
        expect(versionStatus(base, version)).toBe(expected)
    })
})
