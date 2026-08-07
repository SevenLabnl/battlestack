import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { isFeatureEnabled, type Feature } from '@battlestack/core'
import { STAGE } from '@battlestack/core/constants/stages.js'

/** `nuxt-security` wrapper: response headers and a module-level rate-limit floor. */
export const securityFeature: Feature = {
    id: 'shared:security',
    version: '1.0.3',
    label: 'Security headers (nuxt-security)',
    stage: STAGE.BASE_CONFIG,
    failureIsNonFatal: true,

    collectModules() {
        return ['nuxt-security']
    },

    collectDeps() {
        return { prod: ['nuxt-security'] }
    },

    collectDocs() {
        return [
            {
                heading: 'Security headers',
                body: [
                    '`nuxt-security` ships sensible defaults: CSP (same-origin scripts, inline styles allowed for Nuxt UI), HSTS (1-year, prod-only), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy default-deny for camera/microphone/geolocation.',
                    '',
                    'When `nuxt:mastra` is enabled the script-src is widened with `wasm-unsafe-eval` so the AI SDK\'s WebAssembly tokenisers can run. Drop the directive if you remove Mastra after scaffold.',
                    '',
                    '`strict` is left at its default (`false`), which gives `nuxt-security` the leeway to skip directives that would break common app patterns out of the box. Flip to `true` in `nuxt.config.ts#security` once your CSP and headers are stable; the module will then refuse to silently downgrade them.',
                    '',
                    'Override individual fields by editing the `security: {...}` block in `nuxt.config.ts`; that file is yours post-scaffold and `battlestack pull` will not clobber it.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        const needsWasm = isFeatureEnabled(ctx, 'nuxt4:mastra')
        const scriptSrc = needsWasm
            ? ['\'self\'', '\'wasm-unsafe-eval\'', '\'unsafe-eval\'']
            : ['\'self\'', '\'unsafe-eval\'']
        // img-src and media-src cover dev RustFS (localhost) and prod S3 (https).
        const hasStorage = isFeatureEnabled(ctx, 'nuxt4:storage')
        const connectSrc = ['\'self\'', 'ws:', 'wss:']
        const imgSrc = ['\'self\'', 'data:', 'https:']
        const mediaSrc = ['\'self\'', 'https:']
        if (hasStorage) {
            imgSrc.push('http://localhost:*', 'blob:')
            mediaSrc.push('http://localhost:*', 'blob:')
        }
        // A string sentinel, swapped for a raw env-gated expression after the file is written.
        const RATE_LIMITER_SENTINEL = '__BATTLESTACK_RATE_LIMITER_EXPR__'
        await patchNuxtConfig(ctx.projectDir, (c) =>
            c.mutate((cfg) => {
                cfg.security = {
                    headers: {
                        // nuxt-security replaces `{{nonce}}` per request.
                        contentSecurityPolicy: {
                            'default-src': ['\'self\''],
                            'script-src': [...scriptSrc, '\'nonce-{{nonce}}\'', '\'strict-dynamic\''],
                            'style-src': ['\'self\'', '\'unsafe-inline\''],
                            'img-src': imgSrc,
                            'font-src': ['\'self\'', 'data:'],
                            'connect-src': connectSrc,
                            'media-src': mediaSrc,
                            'worker-src': ['\'self\'', 'blob:'],
                            'frame-ancestors': ['\'none\''],
                        },
                        strictTransportSecurity: {
                            maxAge: 31_536_000,
                            includeSubdomains: false,
                        },
                        xFrameOptions: 'DENY',
                        xContentTypeOptions: 'nosniff',
                        referrerPolicy: 'strict-origin-when-cross-origin',
                        permissionsPolicy: {
                            camera: [],
                            microphone: [],
                            geolocation: [],
                        },
                    },
                    rateLimiter: RATE_LIMITER_SENTINEL,
                    xssValidator: false,
                }
            }),
        )
        // `NUXT_RATE_LIMIT_DISABLED=true` disables the per-IP limiter. Dev and e2e only.
        const cfgPath = path.join(ctx.projectDir, 'nuxt.config.ts')
        const raw = await readFile(cfgPath, 'utf8')
        const gated
            = 'process.env.NUXT_RATE_LIMIT_DISABLED === \'true\' ? false : { tokensPerInterval: 100, interval: 60_000 }'
        await writeFile(
            cfgPath,
            raw.replace(new RegExp(String.raw`(['"])${RATE_LIMITER_SENTINEL}\1`), gated),
            'utf8',
        )
    },

    async update(ctx, _prev) {
        await patchNuxtConfig(ctx.projectDir, (c) =>
            c.mutate((cfg) => {
                if (!cfg.security) {
                    cfg.security = {}
                }
            }),
        )
        return { written: ['nuxt.config.ts'], skipped: [], notes: [] }
    },
}
