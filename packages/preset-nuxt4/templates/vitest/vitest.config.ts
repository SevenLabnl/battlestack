import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

// Mirrors Nuxt's alias map for the plain `unit`/`e2e` projects; these are Nuxt 4's fixed, rootDir-relative aliases, so it cannot drift.
// Hardcoded because vitest's resolver ignores tsconfig `paths` on Vite 7, which Nuxt 4.4.x pins. Use `tsconfigPaths: true` once Nuxt is on Vite 8.
const root = dirname(fileURLToPath(import.meta.url))
const alias = {
    '~': join(root, 'app'),
    '@': join(root, 'app'),
    '~~': root,
    '@@': root,
    '#shared': join(root, 'shared'),
    '#server': join(root, 'server'),
    'assets': join(root, 'app/assets'),
    'public': join(root, 'public'),
    '#build': join(root, '.nuxt'),
    '#internal/nuxt/paths': join(root, '.nuxt/paths.mjs'),
}

export default defineConfig({
    // Inlined so the TS transformer never walks up for `compilerOptions`: this scaffold's `tsconfig.json` is solution-style (`references` only).
    // Without it, esbuild reaches the parent repo's tsconfig and errors with `Cannot find base config file`.
    esbuild: {
        tsconfigRaw: {
            compilerOptions: {
                target: 'es2022',
                module: 'esnext',
                moduleResolution: 'bundler',
                useDefineForClassFields: true,
                strict: true,
                esModuleInterop: true,
                resolveJsonModule: true,
                isolatedModules: true,
                skipLibCheck: true,
                verbatimModuleSyntax: false,
            },
        },
    },
    test: {
        projects: [
            {
                resolve: { alias },
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.{test,spec}.ts'],
                    environment: 'node',
                },
            },
            await defineVitestProject({
                test: {
                    name: 'nuxt',
                    include: ['test/nuxt/**/*.{test,spec}.ts'],
                    environment: 'nuxt',
                    environmentOptions: {
                        nuxt: { domEnvironment: 'happy-dom' },
                    },
                },
            }),
            {
                resolve: { alias },
                test: {
                    name: 'e2e',
                    include: ['test/e2e/**/*.{test,spec}.ts'],
                    environment: 'node',
                    testTimeout: 120_000,
                    hookTimeout: 120_000,
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            reportsDirectory: 'coverage',
            include: ['app/**/*.{ts,vue,js,mjs}', 'server/**/*.{ts,js,mjs}'],
            exclude: [
                '**/node_modules/**',
                '.nuxt/**',
                '.output/**',
                'dist/**',
                'coverage/**',
                'test/**',
                '**/*.config.ts',
                '**/*.d.ts',
                'server/database/migrations/**',
                'server/database/seed.ts',
                'i18n/**',
            ],
        },
    },
})
