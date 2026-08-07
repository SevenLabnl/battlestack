import { describe, expect, it } from 'vitest'
import { CLIError, ErrorCode, wrapError } from '../src/utils/errors.js'

describe('CLIError', () => {
    it('formats the user message with its code', () => {
        const err = new CLIError(ErrorCode.DIRECTORY_EXISTS, 'dir taken')
        expect(err.getUserMessage()).toBe('DIRECTORY_EXISTS: dir taken')
        expect(err.name).toBe('CLIError')
    })

    it('exposes recovery hints only for codes that have one', () => {
        expect(
            new CLIError(ErrorCode.EXEC_FAILED, 'x').getRecoveryHint(),
        ).toContain('--debug')
        expect(
            new CLIError(ErrorCode.USER_ABORTED, 'x').getRecoveryHint(),
        ).toBeUndefined()
    })
})

describe('wrapError', () => {
    it('passes CLIError through untouched', () => {
        const original = new CLIError(ErrorCode.UNKNOWN_TEMPLATE, 'nope')
        expect(wrapError(original, ErrorCode.EXEC_FAILED)).toBe(original)
    })

    it('wraps Error instances, keeping the message and cause', () => {
        const cause = new Error('inner boom')
        const wrapped = wrapError(cause, ErrorCode.SCAFFOLD_FAILED)
        expect(wrapped.code).toBe(ErrorCode.SCAFFOLD_FAILED)
        expect(wrapped.message).toBe('inner boom')
        expect(wrapped.cause).toBe(cause)
    })

    it('stringifies non-Error values', () => {
        const wrapped = wrapError('plain failure', ErrorCode.EXEC_FAILED)
        expect(wrapped.message).toBe('plain failure')
    })
})
