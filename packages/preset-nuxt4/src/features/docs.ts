import path from 'node:path'
import {
    isFeatureEnabled,
    writeFileEnsured,
    recordFile,
    hashFile,
    STAGE,
    STAGE_ORDER,
    type DocSection,
    type Feature,
    type RunContext,
} from '@battlestack/core'

/** Generates AGENTS.md, CLAUDE.md and README.md from `collectDocs()`. Always rewritten. */
export const docsFeature: Feature = {
    id: 'nuxt4:docs',
    // 1.0.8: redis-gated bullet. 1.0.9: corrected rule globs from `shared:ai-tool-config` 1.1.6.
    // 1.0.11: extensions docs from `nuxt4:database` 1.6.0 and `nuxt4:rag`.
    // 1.0.14: favicon/app-icon docs from `nuxt4:essentials` 1.1.0 and `nuxt4:pwa` 1.1.0.
    version: '1.0.14',
    label: 'Generate AGENTS.md + CLAUDE.md + README.md',
    frameworks: ['nuxt4'],
    stage: STAGE.DOCS,

    collectDocs(ctx: RunContext): DocSection[] {
        return [
            {
                heading: 'Conventions',
                body: [
                    '- TypeScript everywhere; `noUncheckedIndexedAccess` on.',
                    '- Server routes in `server/api/`. Use `defineEventHandler`.',
                    '- Shared utilities in `server/utils/`. Vue composables in `app/composables/`.',
                    '- Run `battlestack` (no args) inside the project to see all task commands.',
                ].join('\n'),
                targets: ['agents'],
            },
            buildServerStateSection(ctx),
            buildRuntimeConfigSection(ctx),
        ]
    },

    async execute(ctx) {
        const sections = collect(ctx)
        const modulesSection = collectModulesSection(ctx)
        if (modulesSection) sections.unshift(modulesSection)

        const readme = renderReadme(ctx, sections)
        const agentsMd = renderAgentsMd(ctx, sections)
        const claudeMd = renderClaudePointer()

        await writeRecorded(ctx, 'README.md', readme)
        await writeRecorded(ctx, 'AGENTS.md', agentsMd)
        await writeRecorded(ctx, 'CLAUDE.md', claudeMd)
    },

    async update(ctx, prev) {
        await this.execute(ctx)
        return {
            written: ['README.md', 'AGENTS.md', 'CLAUDE.md'],
            skipped: [],
            notes: prev ? ['regenerated from current feature set'] : [],
        }
    },
}

async function writeRecorded(ctx: RunContext, relPath: string, content: string): Promise<void> {
    const dest = path.join(ctx.projectDir, relPath)
    await writeFileEnsured(dest, content)
    recordFile(ctx, 'nuxt4:docs', relPath, await hashFile(dest))
}

/** The "no authoritative module-level state" house rule. File citations are `ctx`-gated. */
function buildServerStateSection(ctx: RunContext): DocSection {
    const hasDb = isFeatureEnabled(ctx, 'nuxt4:database')
    const hasAuth = isFeatureEnabled(ctx, 'nuxt4:auth')
    const hasStorage = isFeatureEnabled(ctx, 'nuxt4:storage')
    const hasRedis = isFeatureEnabled(ctx, 'nuxt4:redis')
    const store = hasDb ? 'Postgres' : 'a durable store'

    const body: string[] = [
        `This app runs as multiple replicas behind a non-sticky load balancer. Server code holds no **authoritative** mutable state outside (1) ${store}, (2) signed/HMAC tokens, or (3) request/connection scope. State that lives only in one replica's memory and matters for correctness is invisible to every other replica. Module-level state is a bug when it *is* the source of truth for a decision. It is fine as a **read-through cache of a decision already durably recorded elsewhere**, as long as losing it costs only a slower request, never a wrong one. Immutable lookup tables (a fixed \`Set\`/\`Map\` built once at module load and never mutated afterward) are always fine.${hasDb ? ' Anything that runs at boot or on a timer takes a Postgres advisory lock (`pg_advisory_xact_lock`) so concurrent replicas don\'t race each other.' : ''}`,
        '',
        `The test to apply: if this process restarts right now and the in-memory state is gone, is anything wrong beyond one extra query or one slower request? If a request would now wrongly succeed or wrongly fail, it's authoritative state and belongs in ${store}. If the only cost is "a little slower until it's warm again," a module-level cache is fine.`,
        '',
        'Three examples:',
        '',
        '- **Bug**: an in-memory request counter that *is* the rate limit. Across N replicas behind a non-sticky load balancer, each one enforces the limit independently against only its own share of traffic. The effective limit becomes roughly N× the intended one, and a flood (or a client that just gets rebalanced mid-burst) sails through.',
        `- **Fine**: an in-memory cache of a denial decision ${store} already recorded (e.g. "blocked until \`resetAt\`"), expiring at that same fixed time. A replica with a cold cache (just restarted, or never saw this key) asks the store, gets the same answer every other replica already has, and caches it too. Losing the cache costs one extra query per replica per denial; it never lets through a request the store would deny, and never denies one it would allow.`,
        `- **Fine**: \`const ALLOWED_MIME_TYPES = new Set([...])\`${hasStorage ? ' (`server/api/files/upload-url.post.ts`)' : ''}: a fixed lookup table built once, nothing to lose on restart.`,
        ...(hasRedis
            ? [`- **Fine, a different shape**: \`server/utils/redis-rate-limit.ts\`'s circuit-breaker flag (\"is Redis reachable from THIS replica right now\"). Unlike the denial-decision cache above, this isn't a cache of anything ${store} recorded; it's a local liveness signal each replica learns and forgets independently. Losing it on restart just means starting optimistic (closed) and re-learning from the next call; it never changes what a rate-limit check answers, only which backend answers it.`]
            : []),
    ]

    const mechanics: string[] = []
    // Ships with the base `nuxt4:auth` tree, so gated on `hasAuth`, not on a specific extra.
    if (hasAuth) {
        mechanics.push('- `server/utils/mfa-challenge.ts`: no server state at all. The MFA challenge is a signed HMAC token (user id + expiry + nonce, signed with the session secret); any replica can issue or verify it without sharing memory with any other.')
    }
    const bootSyncPlugins: string[] = []
    if (isFeatureEnabled(ctx, 'nuxt4:mastra')) bootSyncPlugins.push('`server/plugins/10-sync-ai-on-boot.ts`')
    if (isFeatureEnabled(ctx, 'nuxt4:prompts')) bootSyncPlugins.push('`server/plugins/11-sync-prompts-on-boot.ts`')
    if (hasDb && bootSyncPlugins.length > 0) {
        mechanics.push(`- ${bootSyncPlugins.join(' / ')}: boot-time work that must run exactly once per rollout takes \`pg_advisory_xact_lock\` before touching the database; every other replica booting concurrently blocks on the lock, then no-ops instead of racing.`)
    }
    if (mechanics.length > 0) {
        body.push('', 'Patterns already in this codebase for the mechanics above:', '', ...mechanics)
    }

    body.push('', 'Before adding a module-level variable, apply the restart test above.')

    return {
        heading: 'Server state',
        body: body.join('\n'),
        targets: ['agents'],
    }
}

/** The `runtimeConfig`-not-`process.env` house rule, `ctx`-gated. */
function buildRuntimeConfigSection(ctx: RunContext): DocSection {
    const exceptions: string[] = []
    if (isFeatureEnabled(ctx, 'nuxt4:mastra')) {
        exceptions.push('- `server/mastra/**`: Mastra Studio boots these files outside Nitro, where `useRuntimeConfig()` has no context.')
    }
    if (isFeatureEnabled(ctx, 'nuxt4:database')) {
        exceptions.push('- Standalone scripts Nuxt never builds (`tools/migrate.mjs`, `tools/seed.mjs`, `drizzle.config.ts`, the seed runner under `server/database/seeds/`): nothing tree-shakes them and there\'s no `runtimeConfig` to read outside Nitro.')
    }

    const body: string[] = [
        'Never read `process.env.NUXT_*` in `app/` code: Nuxt statically replaces `process.env`/`import.meta.env` there at build, so the browser never sees your real value; a client read is either baked in forever or silently `undefined`. In `server/` (Nitro) code, `process.env` happens to reflect real container env at actual startup, but reading it directly still skips the same registered-key contract `runtimeConfig` gives you (nothing catches a wrong or mis-cased env var name). Declare a `runtimeConfig` key and read it via `useRuntimeConfig()` instead.',
    ]
    if (exceptions.length > 0) {
        body.push('', 'Exceptions in this project, both deliberate:', '', ...exceptions)
    }
    body.push(
        '',
        '**`process.env.NODE_ENV` specifically: never, anywhere. This is a different mechanism from the rule above, not a variant of it.** Bundlers statically inline `process.env.NODE_ENV` at build time (that\'s what enables dead-code elimination of dev-only branches), so a check keyed on it is frozen forever to whatever the *build machine\'s* env happened to be; a deploy-time env var can never change it. Use `import.meta.dev` for any dev-vs-production branch instead: it fails closed by construction, since a production build compiles the dead branch out entirely rather than just resolving a boolean.',
    )

    return {
        heading: 'Runtime config, not process.env',
        body: body.join('\n'),
        targets: ['agents'],
    }
}

function collect(ctx: RunContext): DocSection[] {
    const sections: DocSection[] = []
    const sortedFeatures = [...ctx.enabledFeatures]
        .map((id) => ctx.registries.features.get(id))
        .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))

    for (const feature of sortedFeatures) {
        const items = feature.collectDocs?.(ctx) ?? []
        for (const item of items ?? []) {
            sections.push({ ...item, order: item.order ?? STAGE_ORDER.indexOf(feature.stage) })
        }
    }
    sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return sections
}

/** "Nuxt modules" section from every enabled feature's `collectModules()`. Null when none declare any. */
function collectModulesSection(ctx: RunContext): DocSection | null {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const id of ctx.enabledFeatures) {
        if (!ctx.registries.features.has(id)) continue
        const feature = ctx.registries.features.get(id)
        const mods = feature.collectModules?.(ctx) ?? []
        for (const m of mods ?? []) {
            if (seen.has(m)) continue
            seen.add(m)
            lines.push(`- \`${m}\`: registered by \`${id}\``)
        }
    }
    if (lines.length === 0) return null
    return {
        heading: 'Nuxt modules',
        body: [
            'Modules already registered in `nuxt.config.ts#modules` by the boilerplate. **Do not** re-add them via `npx nuxi module add`; the scaffold already wired them up at install time, and `battlestack pull` keeps the list in sync as features are added or removed.',
            '',
            ...lines,
        ].join('\n'),
        targets: ['readme', 'agents'],
        // Ordered near the top, before the per-feature sections.
        order: -1,
    }
}

function renderReadme(ctx: RunContext, sections: DocSection[]): string {
    const enabledList = [...ctx.enabledFeatures]
        .map((id) => `- \`${id}\``)
        .join('\n')

    const out: string[] = [
        `# ${ctx.projectName}`,
        '',
        `Generated by \`battlestack\` from template \`${ctx.template.id}\`.`,
        '',
        '## Quick start',
        '',
        '```bash',
        'battlestack            # list every command available in this project',
        'battlestack db:push    # apply drizzle schema (auto-starts postgres)',
        'battlestack db:seed    # seed admin user',
        'battlestack dev        # nuxt dev server (auto-starts postgres if needed)',
        '',
        '# Maintenance',
        'battlestack doctor     # read-only health check (drift, stale features)',
        'battlestack pull       # apply boilerplate template + config changes',
        'battlestack upgrade    # alias for `pull` (picks up feature version bumps)',
        'battlestack bump       # bump npm deps to latest',
        'battlestack sync       # pull + bump + doctor in one shot',
        '```',
        '',
        '## Enabled features',
        '',
        enabledList,
        '',
    ]

    for (const s of sections) {
        if (s.targets && !s.targets.includes('readme')) continue
        out.push(`## ${s.heading}`, '', s.body, '')
    }

    out.push(
        '## Updating',
        '',
        'Run `battlestack pull` (or `battlestack sync`) inside this project to pull',
        'the latest changes from each feature. User-edited files are',
        'preserved; pristine files are re-written. Conflicts produce',
        '`<file>.battlestack.new` + `<file>.battlestack.patch` next to the original.',
        '',
    )

    return out.join('\n')
}

function renderAgentsMd(ctx: RunContext, sections: DocSection[]): string {
    const out: string[] = [
        `# ${ctx.projectName} conventions`,
        '',
        `Stack: ${ctx.framework.label} via \`battlestack\`.`,
        `Template: \`${ctx.template.id}\`.`,
        '',
        '## Enabled features',
        '',
    ]
    for (const id of ctx.enabledFeatures) {
        const f = ctx.registries.features.get(id)
        out.push(`- \`${id}\` v${f.version}: ${f.label}`)
    }
    out.push('')

    for (const s of sections) {
        if (s.targets && !s.targets.includes('agents')) continue
        out.push(`## ${s.heading}`, '', s.body, '')
    }

    return out.join('\n')
}

// CLAUDE.md is a heading plus an `@AGENTS.md` import. AGENTS.md is the canonical source.
function renderClaudePointer(): string {
    return [
        '# Claude Code instructions',
        '',
        '@AGENTS.md',
        '',
    ].join('\n')
}
