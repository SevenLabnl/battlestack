import { describe, expect, it } from 'vitest'
import { usePathStyle } from '#server/utils/storage'

describe('usePathStyle', () => {
    it.each([
        'http://localhost:19296',
        'http://127.0.0.1:9000',
        'http://0.0.0.0:9000',
        'http://[::1]:9000',
        'http://rustfs:9000',
        'http://10.43.0.12:9000',
    ])('uses path-style for %s, which cannot serve <bucket>.<host>', (endpoint) => {
        expect(usePathStyle(endpoint)).toBe(true)
    })

    it.each(['https://s3.nl-ams.scw.cloud', 'https://s3.eu-west-1.amazonaws.com'])('uses virtual-host style for %s', (endpoint) => {
        expect(usePathStyle(endpoint)).toBe(false)
    })

    it('lets NUXT_S3_FORCE_PATH_STYLE override either way', () => {
        expect(usePathStyle('https://s3.nl-ams.scw.cloud', 'true')).toBe(true)
        expect(usePathStyle('http://rustfs:9000', 'false')).toBe(false)
        expect(usePathStyle('http://rustfs:9000', '')).toBe(true)
    })
})
