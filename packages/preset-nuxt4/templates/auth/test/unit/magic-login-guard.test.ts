import { describe, expect, it } from 'vitest'
import { isLocalHost, isMagicLoginAllowed } from '#server/utils/magic-login-guard'

describe('isMagicLoginAllowed', () => {
    it('allows a dev build hitting a local host', () => {
        expect(isMagicLoginAllowed(true, 'localhost:3000')).toBe(true)
        expect(isMagicLoginAllowed(true, '127.0.0.1')).toBe(true)
        expect(isMagicLoginAllowed(true, 'myapp.battlestack.test')).toBe(true)
    })

    it('refuses a non-dev build even against a local host, the property that matters', () => {
        expect(isMagicLoginAllowed(false, 'localhost:3000')).toBe(false)
        expect(isMagicLoginAllowed(false, '127.0.0.1')).toBe(false)
    })

    it('refuses a dev build against a non-local (e.g. tunnelled) host', () => {
        expect(isMagicLoginAllowed(true, 'myapp.ngrok.io')).toBe(false)
        expect(isMagicLoginAllowed(true, 'example.com')).toBe(false)
        expect(isMagicLoginAllowed(true, '')).toBe(false)
    })

    it('refuses when both conditions fail', () => {
        expect(isMagicLoginAllowed(false, 'example.com')).toBe(false)
    })

    // Fails closed by construction: anything other than `isDevBuild === true`, including a non-boolean, must refuse.
    it('fails closed for a non-boolean isDevBuild', () => {
        // @ts-expect-error deliberately non-boolean, proving no truthy coercion grants access.
        expect(isMagicLoginAllowed(1, 'localhost')).toBe(false)
        // @ts-expect-error same, for `undefined`.
        expect(isMagicLoginAllowed(undefined, 'localhost')).toBe(false)
    })
})

describe('isLocalHost', () => {
    it('accepts loopback, .local, and the battlestack gateway domain', () => {
        for (const host of ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'myapp.local', 'myapp.battlestack.test']) {
            expect(isLocalHost(host)).toBe(true)
        }
    })

    it('strips a trailing :<port> before matching', () => {
        expect(isLocalHost('localhost:3000')).toBe(true)
        expect(isLocalHost('127.0.0.1:8080')).toBe(true)
        expect(isLocalHost('myapp.battlestack.test:3000')).toBe(true)
    })

    it('handles bare and bracketed IPv6 loopback, with and without a port', () => {
        expect(isLocalHost('::1')).toBe(true)
        expect(isLocalHost('[::1]')).toBe(true)
        expect(isLocalHost('[::1]:3000')).toBe(true)
    })

    it('rejects a public/tunnelled hostname', () => {
        expect(isLocalHost('example.com')).toBe(false)
        expect(isLocalHost('myapp.ngrok.io')).toBe(false)
        expect(isLocalHost('')).toBe(false)
    })
})
