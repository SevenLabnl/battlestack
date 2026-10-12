import { describe, expect, it } from 'vitest'
import { checkPasswordPolicy } from '../../shared/utils/password-policy.js'

describe('checkPasswordPolicy', () => {
    it('keeps the 12-character minimum and accepts its exact boundary', () => {
        expect(checkPasswordPolicy('Birch7!Abcd')).toMatchObject({ valid: false, code: 'minLength' })
        expect(checkPasswordPolicy('Birch7!Abcde')).toEqual({ valid: true })
    })

    it.each([
        ['lowercase', 'LONGENOUGH12!'],
        ['uppercase', 'longenough12!'],
        ['digit', 'LongEnoughAbc!'],
        ['symbol', 'LongEnough12'],
    ])('identifies a missing %s without rejecting other composition rules', (code, password) => {
        expect(checkPasswordPolicy(password)).toMatchObject({
            valid: false,
            code,
        })
    })

    it.each([
        ['minLength', ''],
        ['lowercase', '!!!!!!!!!!!!'],
        ['uppercase', 'abcdefghijkl'],
        ['digit', 'Abcdefghijkl'],
        ['symbol', 'Password1234'],
        ['common', 'Password123!'],
    ])('reports %s before later failing rules', (code, password) => {
        expect(checkPasswordPolicy(password)).toMatchObject({ valid: false, code })
    })

    it.each([
        'P.a.s.s.w.o.r.d42!',
        'Birch7!WELCOMEzz',
        'Birch7!qwerTYzz',
    ])('rejects normalized common substrings in %s', (password) => {
        expect(checkPasswordPolicy(password)).toMatchObject({ valid: false, code: 'common' })
    })

    it.each([
        'Birch7 Abcde',
        'Birch7\tAbcde',
        'Birch7\nAbcde',
        'Birch7éAbcde',
        'Birch7😀Abcd',
    ])('continues to accept whitespace or non-ASCII characters as symbols in %j', (password) => {
        expect(checkPasswordPolicy(password)).toEqual({ valid: true })
    })

    it('accepts a strong password without imposing a maximum length', () => {
        expect(checkPasswordPolicy('Mountain-Pine42!')).toEqual({ valid: true })
        expect(checkPasswordPolicy(`Mountain-Pine42!${'a'.repeat(300)}`)).toEqual({ valid: true })
    })
})
