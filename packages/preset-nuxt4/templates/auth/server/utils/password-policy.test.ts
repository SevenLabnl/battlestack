import { describe, expect, it } from 'vitest'
import { checkPasswordPolicy, PASSWORD_MIN_LENGTH } from './password-policy.js'

describe('checkPasswordPolicy', () => {
    it('rejects passwords shorter than the minimum length', () => {
        const result = checkPasswordPolicy('Aa1!aaaaaaa') // 11 chars
        expect(result).toEqual({
            valid: false,
            error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
        })
    })

    it('rejects passwords missing a symbol', () => {
        const result = checkPasswordPolicy('LongEnough12')
        expect(result).toEqual({
            valid: false,
            error: 'Password must contain a symbol',
        })
    })

    it('rejects passwords missing a lowercase letter', () => {
        const result = checkPasswordPolicy('LONGENOUGH12!')
        expect(result).toEqual({
            valid: false,
            error: 'Password must contain a lowercase letter',
        })
    })

    it('rejects passwords missing an uppercase letter', () => {
        const result = checkPasswordPolicy('longenough12!')
        expect(result).toEqual({
            valid: false,
            error: 'Password must contain an uppercase letter',
        })
    })

    it('rejects passwords missing a digit', () => {
        const result = checkPasswordPolicy('LongEnoughAbc!')
        expect(result).toEqual({
            valid: false,
            error: 'Password must contain a digit',
        })
    })

    it('rejects common passwords after normalising case + symbols', () => {
        const result = checkPasswordPolicy('Password123!')
        expect(result).toEqual({
            valid: false,
            error: 'Password is too common',
        })
    })

    it('accepts a strong password', () => {
        const result = checkPasswordPolicy('Mountain-Pine42!')
        expect(result).toEqual({ valid: true })
    })
})
