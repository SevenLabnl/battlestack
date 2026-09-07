import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { exists, writeFileEnsured, STAGE, type Feature } from '@battlestack/core'
import { ui } from '@battlestack/tui'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

const REQUIRED_PATTERNS = [
    'node_modules',
    '.nuxt',
    '.output',
    '.data',
    '.nitro',
    '.cache',
    'dist',
    '.DS_Store',
    '.idea',
    '.vscode',
    '.env',
    '.env.*',
    '!.env.example',
    'auto-imports.d.ts',
    'components.d.ts',
    '.battlestack/local.json',
    '.battlestack/lock',
    // `battlestack pull` stages merge artifacts here. They may hold secrets.
    '.battlestack/pull/',
    '.mastra',
    // Fetched third-party skill content, recorded by the tracked `skills-lock.json`.
    '.agents/',
    // Legacy in-tree pull artifacts. Never a bare `*.battlestack`.
    '*.battlestack.bak',
    '*.battlestack.new',
    '*.battlestack.patch',
]

// Patterns earlier CLI versions emitted, removed here.
const OBSOLETE_PATTERNS = [
    '*.battlestack',
    '*.wolf',
    '*.wolf.bak',
    '*.wolf.new',
    '*.wolf.patch',
    // Scan scratch for tooling that no longer ships in the public preset.
    '.scannerwork',
    'dependencycheck',
]

async function applyPatterns(projectDir: string): Promise<void> {
    const target = path.join(projectDir, '.gitignore')
    const current = (await exists(target)) ? await readFile(target, 'utf8') : ''
    const lines = new Set(current.split('\n').map((l) => l.trim()).filter(Boolean))
    for (const p of OBSOLETE_PATTERNS) lines.delete(p)
    for (const p of REQUIRED_PATTERNS) lines.add(p)
    await writeFileEnsured(target, [...lines].join('\n') + '\n')
}

// Legacy in-tree merge artifacts, hidden from Nitro's scanner.
const NUXT_IGNORE_PATTERNS = [
    '**/*.battlestack.bak',
    '**/*.battlestack.new',
    '**/*.battlestack.patch',
    '**/*.battlestack',
    '**/*.wolf.bak',
    '**/*.wolf.new',
    '**/*.wolf.patch',
    '**/*.wolf',
]

// `eslint .` walks the project root, including the `.agents/` trees `skills add` fetches.
const ESLINT_IGNORE_PATTERNS = ['.agents/**']

// Marks our block so the insert happens exactly once. The config file stays the user's.
const ESLINT_IGNORE_MARKER = 'battlestack:fetched-skills'

const ESLINT_CONFIG_FILE = 'eslint.config.mjs'

/** Text-inserts an `ignores` entry for fetched skill content into the flat ESLint config. */
async function applyEslintIgnore(projectDir: string): Promise<void> {
    const target = path.join(projectDir, ESLINT_CONFIG_FILE)
    // An adopted project may never have added `@nuxt/eslint`.
    if (!(await exists(target))) return

    const current = await readFile(target, 'utf8')
    if (current.includes(ESLINT_IGNORE_MARKER)) return

    // `withNuxt(` is `@nuxt/eslint`'s documented entry point.
    const anchor = current.indexOf('withNuxt(')
    if (anchor === -1) {
        ui.warn(
            `${ESLINT_CONFIG_FILE}: no \`withNuxt(\` call found; skipping the `
            + `\`${ESLINT_IGNORE_PATTERNS.join(', ')}\` ignore. Fetched AI-agent skill `
            + 'content under `.agents/` is third-party code; add it to this config\'s '
            + '`ignores` by hand or `eslint .` will lint it as if it were yours.',
        )
        return
    }

    const insertAt = anchor + 'withNuxt('.length
    const patterns = ESLINT_IGNORE_PATTERNS.map((p) => `'${p}'`).join(', ')
    const block = [
        '',
        `    // ${ESLINT_IGNORE_MARKER} (managed by @battlestack/preset-nuxt)`,
        '    // Third-party skill trees fetched by `skills add`; not this project\'s',
        '    // code, so linting them reports someone else\'s style as ours.',
        `    { ignores: [${patterns}] },`,
    ].join('\n')

    await writeFileEnsured(target, current.slice(0, insertAt) + block + current.slice(insertAt))
}

// A second, distinct marker from the ignore block's.
const ESLINT_STYLE_MARKER = 'battlestack:formatting'

/** Pins `vue/html-self-closing`. */
async function applyEslintStyle(projectDir: string): Promise<void> {
    const target = path.join(projectDir, ESLINT_CONFIG_FILE)
    if (!(await exists(target))) return

    const current = await readFile(target, 'utf8')
    if (current.includes(ESLINT_STYLE_MARKER)) return

    const anchor = current.indexOf('withNuxt(')
    if (anchor === -1) {
        ui.warn(
            `${ESLINT_CONFIG_FILE}: no \`withNuxt(\` call found; skipping the `
            + 'formatting rules. `<img />` may be reformatted against your '
            + 'preference; add `vue/html-self-closing` to this config by hand.',
        )
        return
    }

    const insertAt = anchor + 'withNuxt('.length
    const block = [
        '',
        `    // ${ESLINT_STYLE_MARKER} (managed by @battlestack/preset-nuxt)`,
        '    // ESLint owns formatting (no Prettier). Self-closing tags are allowed',
        '    // on purpose: `<img />` reads as a thing, not as an unclosed tag.',
        '    {',
        '        rules: {',
        "            'vue/html-self-closing': ['error', {",
        "                html: { void: 'always', normal: 'always', component: 'always' },",
        '            }],',
        '        },',
        '    },',
    ].join('\n')

    await writeFileEnsured(target, current.slice(0, insertAt) + block + current.slice(insertAt))
}

/** Stylistic rules replacing `.prettierrc.json`, compatible with it and `.editorconfig`. */
async function applyStylisticConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mutate((cfg) => {
            if (!cfg.eslint) cfg.eslint = {}
            const eslint = cfg.eslint as Record<string, unknown>
            if (!eslint.config) eslint.config = {}
            const config = eslint.config as Record<string, unknown>
            config.stylistic = {
                indent: 4,
                quotes: 'single',
                semi: false,
                commaDangle: 'always-multiline',
                arrowParens: true,
                braceStyle: '1tbs',
            }
        })
    })
}

async function applyNuxtIgnore(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mutate((cfg) => {
            const existing = Array.isArray(cfg.ignore) ? (cfg.ignore as string[]) : []
            const merged = new Set<string>(existing)
            for (const p of NUXT_IGNORE_PATTERNS) merged.add(p)
            cfg.ignore = [...merged]

            // Set directly on Nitro. Assigned then re-read, not via `??=`.
            if (!cfg.nitro) cfg.nitro = {}
            const nitro = cfg.nitro as Record<string, unknown>
            const nitroIgnore = Array.isArray(nitro.ignore) ? (nitro.ignore as string[]) : []
            const nitroMerged = new Set<string>(nitroIgnore)
            for (const p of NUXT_IGNORE_PATTERNS) nitroMerged.add(p)
            nitro.ignore = [...nitroMerged]
        })
    })
}

/** Ignore patterns for git, Nuxt's and Nitro's auto-import scanners, and the ESLint config. */
export const gitignoreFeature: Feature = {
    id: 'nuxt4:gitignore',
    // 1.4.0: owns the ESLint formatting and stylistic rules.
    version: '1.5.0',
    label: 'Enforce ignore patterns (git, Nuxt, ESLint)',
    frameworks: ['nuxt4'],
    stage: STAGE.GITIGNORE,

    async execute(ctx) {
        await applyPatterns(ctx.projectDir)
        await applyNuxtIgnore(ctx.projectDir)
        await applyEslintIgnore(ctx.projectDir)
        await applyEslintStyle(ctx.projectDir)
        await applyStylisticConfig(ctx.projectDir)
    },

    async update(ctx) {
        await applyPatterns(ctx.projectDir)
        await applyNuxtIgnore(ctx.projectDir)
        await applyEslintIgnore(ctx.projectDir)
        await applyEslintStyle(ctx.projectDir)
        await applyStylisticConfig(ctx.projectDir)
        return {
            written: ['.gitignore', 'nuxt.config.ts', ESLINT_CONFIG_FILE],
            skipped: [],
            notes: [],
        }
    },
}
