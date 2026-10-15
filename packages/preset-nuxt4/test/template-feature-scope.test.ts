import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyPlugin, BattlestackRegistries, finalizeRegistries } from '@battlestack/core'
import presetNuxt4 from '../src/index.js'

/**
 * A feature's templates may only reference what its own feature, a feature it `requires`,
 * or the feature that gates its subtree ships. Anything else is missing from a project
 * without that feature: an import breaks the build, an API call fails at runtime.
 */

const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

/** Subtrees whose directory isn't the feature's bare name, and the feature that gates them. */
const SUBTREES: Record<string, { feature: string, gatedBy?: string }> = {
    'i18n-auth': { feature: 'nuxt4:i18n', gatedBy: 'nuxt4:auth' },
    'mastra-admin': { feature: 'nuxt4:mastra', gatedBy: 'nuxt4:user-admin' },
    'health/with-db': { feature: 'nuxt4:health', gatedBy: 'nuxt4:database' },
    'health/env-only': { feature: 'nuxt4:health' },
    'chat/http': { feature: 'nuxt4:chat' },
    'chat/ws-nitro': { feature: 'nuxt4:chat' },
    'ai-tool-config/claude-code': { feature: 'shared:ai-tool-config' },
    '.github': { feature: 'shared:github' },
}

/** Files a feature writes from code rather than from its template directory. */
const WRITTEN_BY_CODE: Record<string, string> = {
    // `nuxt4:auth` writes a no-op stub when `nuxt4:audit-log` is off.
    'server/utils/audit.ts': 'nuxt4:auth',
}

/** Calls into a feature that isn't required, each guarded where it is made. `subtree/file -> feature`. */
const OPTIONAL_CALLS = new Set([
    // Buttons render only for providers in runtimeConfig.public.oauthProviders, which nuxt4:oauth sets.
    'auth/app/pages/login.vue -> nuxt4:oauth',
    // Only after login answers EMAIL_NOT_VERIFIED, which needs nuxt4:auth-verification's table.
    'auth/app/pages/login.vue -> nuxt4:auth-verification',
    // Only after login answers requiresMfa, which needs an enabled totp_secrets row.
    'auth/app/composables/useAuth.ts -> nuxt4:auth-2fa',
    // Probed on load; a 404 hides the card.
    'dashboard-shell/app/pages/dashboard/security.vue -> nuxt4:auth-passkeys',
    'dashboard-shell/app/pages/dashboard/security.vue -> nuxt4:audit-log',
    // Fetched in a try/catch; a missing route keeps the default avatar.
    'landing-shell/app/layouts/default.vue -> nuxt4:storage',
    // `.catch` falls back to an empty list.
    'mastra-admin/app/pages/dashboard/settings/ai.vue -> nuxt4:prompts',
    // loginAs/loginAsAdmin: every caller's feature requires nuxt4:auth.
    'vitest/test/helpers/setup.ts -> nuxt4:auth',
])

/** Known violations awaiting a fix. Remove an entry when it is fixed; the test fails on a stale one. */
const KNOWN_VIOLATIONS = new Set([
    // Health's session-secret check imports auth's helper; database without auth does not build.
    'health/with-db/server/utils/health-checks.ts -> nuxt4:auth',
    'health/with-db/test/unit/health.test.ts -> nuxt4:auth',
    // createTestUser posts /api/users, but auth-2fa's and storage's tests call it without requiring user-admin.
    'vitest/test/helpers/setup.ts -> nuxt4:user-admin',
])

interface Template { subtree: string, rel: string }

async function listTemplates(): Promise<Template[]> {
    const entries = await readdir(TEMPLATES, { recursive: true, withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => {
        const parts = path.relative(TEMPLATES, path.join(e.parentPath, e.name)).split(path.sep)
        const depth = Object.keys(SUBTREES).some((s) => s.includes('/') && s.startsWith(`${parts[0]}/`)) ? 2 : 1
        return { subtree: parts.slice(0, depth).join('/'), rel: parts.slice(depth).join('/') }
    })
}

/** Line and block comments: a mention in prose is not a reference. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '')
}

function importedPath(spec: string, fromRel: string): string | undefined {
    if (spec.startsWith('~~/')) return spec.slice(3)
    if (spec.startsWith('~/')) return `app/${spec.slice(2)}`
    if (spec.startsWith('#server/')) return `server/${spec.slice(8)}`
    if (spec.startsWith('#shared/')) return `shared/${spec.slice(8)}`
    if (spec.startsWith('./') || spec.startsWith('../')) return path.posix.join(path.posix.dirname(fromRel), spec)
    return undefined
}

function routeSegments(routeFile: string): string[] {
    return routeFile
        .replace(/^server\/(routes\/)?/, '')
        .replace(/(\.(get|post|put|patch|delete))?\.ts$/, '')
        .replace(/(^|\/)index$/, '')
        .split('/')
        .filter(Boolean)
}

describe('templates reference only features their own feature can rely on', () => {
    let registries: BattlestackRegistries
    let templates: Template[]
    beforeAll(async () => {
        registries = new BattlestackRegistries()
        const { extensions } = applyPlugin(presetNuxt4, 'bundled', registries)
        expect(finalizeRegistries(registries, extensions)).toEqual([])
        templates = await listTemplates()
    })

    const featureOf = (subtree: string): string => {
        const mapped = SUBTREES[subtree]?.feature
        if (mapped) return registries.features.get(mapped).id
        const id = [`nuxt4:${subtree}`, `shared:${subtree}`].find((c) => registries.features.has(c))
        if (!id) throw new Error(`templates/${subtree} maps to no feature: add it to SUBTREES`)
        return registries.features.get(id).id
    }

    const requiresClosure = (id: string, into = new Set<string>()): Set<string> => {
        const bare = registries.features.get(id).id
        if (into.has(bare)) return into
        into.add(bare)
        for (const dep of registries.features.get(bare).requires ?? []) requiresClosure(dep, into)
        return into
    }

    async function scan(): Promise<string[]> {
        const providers = new Map<string, Set<string>>()
        const provide = (rel: string, feature: string) =>
            providers.set(rel, (providers.get(rel) ?? new Set()).add(feature))
        for (const t of templates) provide(t.rel, featureOf(t.subtree))
        for (const [rel, feature] of Object.entries(WRITTEN_BY_CODE)) provide(rel, registries.features.get(feature).id)

        const resolveImport = (p: string) =>
            [p, `${p}.ts`, `${p}.vue`, `${p}/index.ts`, p.replace(/\.js$/, '.ts')].find((c) => providers.has(c))
        const routes = [...providers.keys()].filter((k) => /^server\/(api|routes)\//.test(k))
        const resolveCall = (url: string) => {
            const segs = url.replace(/[?#].*$/, '').split('/').filter(Boolean)
            return routes.find((r) => {
                const rs = routeSegments(r)
                return rs.length === segs.length && rs.every((s, i) => s.startsWith('[') || s === segs[i] || segs[i]!.includes('${'))
            })
        }

        const found = new Set<string>()
        await Promise.all(templates.filter((t) => /\.(ts|vue|mjs)$/.test(t.rel)).map(async (t) => {
            const feature = featureOf(t.subtree)
            const allowed = requiresClosure(feature)
            const gate = SUBTREES[t.subtree]?.gatedBy
            if (gate) requiresClosure(gate, allowed)
            const src = stripComments(await readFile(path.join(TEMPLATES, t.subtree, t.rel), 'utf8'))
            const at = `${t.subtree}/${t.rel}`

            const check = (target: string | undefined, kind: 'import' | 'call') => {
                if (!target) return
                const owners = providers.get(target)!
                if ([...owners].some((o) => allowed.has(o))) return
                // A test runs under vitest's runner, so it may use vitest's helpers.
                if (kind === 'import' && t.rel.startsWith('test/') && owners.has('nuxt4:vitest')) return
                for (const owner of owners) {
                    const key = `${at} -> ${owner}`
                    if (kind === 'call' && OPTIONAL_CALLS.has(key)) continue
                    found.add(key)
                }
            }
            for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
                const p = importedPath(m[1]!, t.rel)
                if (p) check(resolveImport(p), 'import')
            }
            for (const m of src.matchAll(/['"`](\/api\/[^'"`\s]*)/g)) check(resolveCall(m[1]!), 'call')
        }))
        return [...found].sort()
    }

    it('no template reaches into a feature its own does not require', async () => {
        const violations = await scan()
        expect(violations.filter((v) => !KNOWN_VIOLATIONS.has(v))).toEqual([])
        expect([...KNOWN_VIOLATIONS].filter((v) => !violations.includes(v))).toEqual([])
    })
})
