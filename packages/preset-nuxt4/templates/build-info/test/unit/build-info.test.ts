import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBuildInfo } from '~/composables/useBuildInfo'

// `useRuntimeConfig` is a Nuxt auto-import, so it only exists as a global at runtime.
// The composable reads it through that global binding, which is exactly what this stubs.
function withPublicConfig(publicConfig: Record<string, unknown>): void {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: publicConfig }))
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('useBuildInfo', () => {
    it('reports the version, commit and build time the image was built with', () => {
        withPublicConfig({
            appVersion: '1.4.2',
            appCommit: '9f1c0a7b2d3e4f5061728394a5b6c7d8e9f00112',
            appBuiltAt: '2026-09-22T09:15:00Z',
            appRepoUrl: 'https://github.com/acme/widgets',
        })

        expect(useBuildInfo()).toEqual({
            version: '1.4.2',
            commit: '9f1c0a7b2d3e4f5061728394a5b6c7d8e9f00112',
            shortCommit: '9f1c0a7',
            builtAt: '2026-09-22T09:15:00Z',
            commitUrl: 'https://github.com/acme/widgets/commit/9f1c0a7b2d3e4f5061728394a5b6c7d8e9f00112',
        })
    })

    // An unknown commit must read as unknown. A dev server that invented one would make
    // the footer useless precisely where it is supposed to be authoritative.
    it('falls back to `dev` and an empty commit when nothing was baked in', () => {
        withPublicConfig({})

        const build = useBuildInfo()
        expect(build.version).toBe('dev')
        expect(build.commit).toBe('')
        expect(build.shortCommit).toBe('')
        expect(build.commitUrl).toBe('')
    })

    it('builds no commit link without a repo URL, and none without a commit', () => {
        withPublicConfig({ appCommit: '9f1c0a7b2d3e4f5061728394a5b6c7d8e9f00112' })
        expect(useBuildInfo().commitUrl).toBe('')

        withPublicConfig({ appRepoUrl: 'https://github.com/acme/widgets' })
        expect(useBuildInfo().commitUrl).toBe('')
    })

    it('tolerates a repo URL with trailing slashes', () => {
        withPublicConfig({
            appCommit: '9f1c0a7b2d3e4f5061728394a5b6c7d8e9f00112',
            appRepoUrl: 'https://github.com/acme/widgets//',
        })

        expect(useBuildInfo().commitUrl).toBe(
            'https://github.com/acme/widgets/commit/9f1c0a7b2d3e4f5061728394a5b6c7d8e9f00112',
        )
    })

    it('ignores non-string config values rather than rendering them', () => {
        withPublicConfig({ appVersion: 42, appCommit: null, appRepoUrl: { url: 'x' } })

        const build = useBuildInfo()
        expect(build.version).toBe('dev')
        expect(build.commit).toBe('')
        expect(build.commitUrl).toBe('')
    })
})
