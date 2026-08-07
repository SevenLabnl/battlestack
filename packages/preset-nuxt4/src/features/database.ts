import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
    allocatePort,
    CLIError,
    ErrorCode,
    hashFile,
    isFeatureEnabled,
    MANIFEST_PATH,
    readJson,
    readManifest,
    recordFile,
    resolveProjectPM,
    run,
    writeFileEnsured,
    writeJson,
    STAGE,
    type EnvVar,
    type Feature,
    type ProjectCommand,
    type RunContext,
} from '@battlestack/core'
import { applyDbExtensions, waitForPgReady } from '@battlestack/core/utils/db.js'
import { ui } from '@battlestack/tui'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/** Sets `state.seeded` on the `nuxt4:database` manifest record. No-op when already `true`. */
export async function markDatabaseSeeded(projectDir: string, featureFqid: string): Promise<void> {
    const m = await readManifest(projectDir)
    if (!m) return
    const record = m.features.find((f) => f.id === featureFqid)
    if (!record) return
    if (record.state?.seeded === true) return
    record.state = { ...record.state, seeded: true }
    m.updatedAt = new Date().toISOString()
    await writeJson(path.join(projectDir, MANIFEST_PATH), m)
}

export async function isDatabaseSeeded(projectDir: string, featureFqid: string): Promise<boolean> {
    const m = await readManifest(projectDir)
    return Boolean(m?.features.find((f) => f.id === featureFqid)?.state?.seeded)
}

const COMPOSE_FILE = 'docker-compose.yml'

function buildComposeYml(ctx: RunContext): string {
    const dbPort = allocatePort(ctx.projectName, 'db')
    const appPort = allocatePort(ctx.projectName, 'app')
    const hasAuth = isFeatureEnabled(ctx, 'nuxt4:auth')
    const hasStorage = isFeatureEnabled(ctx, 'nuxt4:storage')
    const hasRedis = isFeatureEnabled(ctx, 'nuxt4:redis')

    const services: string[] = []
    // Profile-gated: only `docker compose --profile prod` activates it. Service URLs use compose DNS.
    const appEnvLines: string[] = [
        '            NUXT_HOST: 0.0.0.0',
        '            NUXT_PORT: "3000"',
        '            NUXT_DATABASE_URL: postgres://postgres:postgres@db:5432/${DB_NAME:-app}',
        `            NUXT_PUBLIC_APP_URL: \${APP_URL:-http://localhost:\${APP_PORT:-${appPort}}}`,
    ]
    if (hasAuth) {
        appEnvLines.push(
            '            NUXT_SMTP_HOST: mailpit',
            '            NUXT_SMTP_PORT: "1025"',
            // Mailpit implements no STARTTLS. Real deploys omit this so TLS stays enforced.
            '            NUXT_SMTP_REQUIRE_TLS: "false"',
        )
    }
    if (hasStorage) {
        appEnvLines.push(
            '            NUXT_S3_ENDPOINT: http://rustfs:9000',
        )
    }
    if (hasRedis) {
        appEnvLines.push(
            '            NUXT_REDIS_URL: redis://redis:6379',
        )
    }
    const appDepends: string[] = [
        '        depends_on:',
        '            db:',
        '                condition: service_healthy',
        '            migrate:',
        '                condition: service_completed_successfully',
        '            seed:',
        '                condition: service_completed_successfully',
    ]
    if (hasAuth) {
        appDepends.push('            mailpit:', '                condition: service_started')
    }
    if (hasStorage) {
        appDepends.push('            rustfs:', '                condition: service_started')
    }
    if (hasRedis) {
        // `service_started`, not `service_healthy`: Redis is only an accelerator.
        appDepends.push('            redis:', '                condition: service_started')
    }

    // One-shot services the `prod` profile runs before `app`. Only `migrate` mirrors a real deploy.
    const migrateService = [
        '    migrate:',
        '        profiles: ["prod"]',
        `        image: ${ctx.projectName}:dev`,
        '        command: ["node", "/app/server/migrate.mjs"]',
        '        env_file: .env',
        '        environment:',
        '            NUXT_DATABASE_URL: postgres://postgres:postgres@db:5432/${DB_NAME:-app}',
        '        depends_on:',
        '            db:',
        '                condition: service_healthy',
    ].join('\n')

    const seedService = [
        '    seed:',
        '        profiles: ["prod"]',
        `        image: ${ctx.projectName}:dev`,
        '        command: ["node", "/app/server/seed.mjs"]',
        '        env_file: .env',
        '        environment:',
        '            NUXT_DATABASE_URL: postgres://postgres:postgres@db:5432/${DB_NAME:-app}',
        '        depends_on:',
        '            db:',
        '                condition: service_healthy',
        '            migrate:',
        '                condition: service_completed_successfully',
    ].join('\n')

    const appService = [
        '    app:',
        '        profiles: ["prod"]',
        '        build:',
        '            context: .',
        '            args:',
        '                BUILD_NUMBER: dev',
        `        image: ${ctx.projectName}:dev`,
        '        restart: unless-stopped',
        '        env_file: .env',
        '        environment:',
        ...appEnvLines,
        '        ports:',
        `            - "\${APP_PORT:-${appPort}}:3000"`,
        ...appDepends,
    ].join('\n')

    services.push(migrateService, seedService, appService)

    services.push(`    db:
        image: pgvector/pgvector:pg18
        restart: unless-stopped
        environment:
            POSTGRES_DB: \${DB_NAME:-app}
            POSTGRES_USER: postgres
            POSTGRES_PASSWORD: postgres
        ports:
            - "\${DB_PORT:-${dbPort}}:5432"
        volumes:
            - db_data:/var/lib/postgresql
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U postgres -d \${DB_NAME:-app}"]
            interval: 5s
            timeout: 5s
            retries: 10`)

    const volumes: string[] = ['    db_data:']

    if (hasAuth) {
        const smtp = allocatePort(ctx.projectName, 'smtp')
        const mailUi = allocatePort(ctx.projectName, 'mail-ui')
        services.push(`    mailpit:
        image: axllent/mailpit:latest
        restart: unless-stopped
        environment:
            MP_MAX_MESSAGES: "5000"
            MP_DATABASE: "/data/mailpit.db"
        ports:
            - "\${SMTP_PORT:-${smtp}}:1025"
            - "\${MAIL_UI_PORT:-${mailUi}}:8025"
        volumes:
            - mailpit_data:/data`)
        volumes.push('    mailpit_data:')
    }

    if (hasStorage) {
        const s3Api = allocatePort(ctx.projectName, 's3-api')
        const s3Console = allocatePort(ctx.projectName, 's3-console')
        services.push(`    rustfs:
        image: rustfs/rustfs:latest
        restart: unless-stopped
        environment:
            RUSTFS_ACCESS_KEY: \${S3_ACCESS_KEY:-rustfsadmin}
            RUSTFS_SECRET_KEY: \${S3_SECRET_KEY:-rustfsadmin}
            RUSTFS_ADDRESS: ":9000"
            RUSTFS_CONSOLE_ENABLE: "true"
            RUSTFS_CONSOLE_ADDRESS: ":9001"
        ports:
            - "\${S3_API_PORT:-${s3Api}}:9000"
            - "\${S3_CONSOLE_PORT:-${s3Console}}:9001"
        volumes:
            - rustfs_data:/data`)
        volumes.push('    rustfs_data:')
    }

    if (hasRedis) {
        const redisPort = allocatePort(ctx.projectName, 'redis')
        // No named volume: rate-limit counters are short-TTL. Postgres is the durable store.
        services.push(`    redis:
        image: redis:7-alpine
        restart: unless-stopped
        ports:
            - "\${REDIS_PORT:-${redisPort}}:6379"
        healthcheck:
            test: ["CMD", "redis-cli", "ping"]
            interval: 5s
            timeout: 5s
            retries: 10`)
    }

    return `# Generated by battlestack. Per-project dev services (postgres${
        hasAuth ? ' + mailpit' : ''
    }${hasStorage ? ' + rustfs' : ''}${hasRedis ? ' + redis' : ''}).
name: ${ctx.projectName}

services:
${services.join('\n\n')}

volumes:
${volumes.join('\n')}
`
}

async function emitCompose(ctx: RunContext): Promise<void> {
    const dest = path.join(ctx.projectDir, COMPOSE_FILE)
    await writeFileEnsured(dest, buildComposeYml(ctx))
    recordFile(ctx, 'nuxt4:database', COMPOSE_FILE, await hashFile(dest))
}

// Must be registered: Nuxt only maps these env vars onto existing runtimeConfig keys.
async function registerRuntimeConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.mergeRuntimeConfig({
            databaseUrl: '',
            disableDbMigrateOnBoot: false,
        })
    })
}

/** PostgreSQL 18 in Docker, Drizzle ORM, users schema, seed script. */
export const databaseFeature: Feature = {
    id: 'nuxt4:database',
    // 1.5.0: `buildComposeYml` grows a `redis` service when `nuxt4:redis` is enabled.
    version: '1.5.0',
    label: 'PostgreSQL + Drizzle ORM (Docker)',
    frameworks: ['nuxt4'],
    stage: STAGE.DATABASE,

    collectDeps() {
        return {
            prod: ['drizzle-orm', 'postgres', '@node-rs/argon2'],
            dev: ['drizzle-kit', 'dotenv', 'tsx'],
        }
    },

    collectDocs() {
        return [
            {
                heading: 'Database',
                body: [
                    'PostgreSQL 18 in Docker, Drizzle ORM. Schema lives in `server/database/schema/`.',
                    '',
                    'Common commands (run from project root):',
                    '',
                    '```bash',
                    'battlestack db:up        # start postgres',
                    'battlestack db:push      # apply schema (dev)',
                    'battlestack db:generate  # emit SQL migration files (prod)',
                    'battlestack db:migrate   # apply SQL migrations (prod)',
                    'battlestack db:seed      # seed admin + reference data',
                    'battlestack db:studio    # open drizzle studio',
                    'battlestack db:psql      # interactive psql shell',
                    '```',
                    '',
                    'Every `battlestack db:*` task wraps a `db:*` script in `package.json`. If `battlestack` is not on',
                    'your PATH (e.g. CI, AI agents), run the script directly: `pnpm run db:generate`,',
                    '`pnpm run db:migrate`, `pnpm run db:push`, `pnpm run db:seed`.',
                    '',
                    '**AI agents:** after editing any file in `server/database/schema/`, you MUST run',
                    '`pnpm run db:generate` and commit the emitted SQL + `meta/_journal.json` alongside the',
                    'schema change. Do not stop at the TypeScript edit; see the schema-change workflow below.',
                    '',
                    '### Dev vs prod workflow',
                    '',
                    'Production deploys are the source of truth for **schema**: whatever runs the container',
                    'executes `node /app/server/migrate.mjs` against the prod database before traffic is routed',
                    'to it. It is safe to run from every replica at once: the script takes a Postgres advisory',
                    'lock before reading what has been applied (shared with `server/plugins/00-db-migrate-on-boot.ts`),',
                    'so exactly one caller migrates and the rest block, then no-op.',
                    '',
                    'Seeding is **not** part of a deploy. It creates and mutates accounts, so nothing wires it',
                    'into container startup automatically; a deployed environment is seeded by running the',
                    'command deliberately, per project. `seed.mjs` also refuses to run when `NODE_ENV=production`',
                    'is actually set (override with `SEED_ALLOW_PRODUCTION=true`), but treat that as a courtesy',
                    'trip-wire, not the real safety net: nothing in this Dockerfile or the k8s manifests sets',
                    '`NODE_ENV`, so in a real container this check likely never fires. What actually makes an',
                    'accidental or concurrent run harmless is the DB-side marker (`drizzle.__battlestack_seeded`)',
                    'plus the advisory lock around it: a second/unexpected invocation no-ops instead of',
                    're-seeding, regardless of whether the `NODE_ENV` check ever triggered.',
                    '',
                    '| Stage | Local dev | Production |',
                    '| --- | --- | --- |',
                    '| Schema | `battlestack db:push` (direct sync) | `migrate.mjs` applies the SQL files committed to `server/database/migrations/` |',
                    '| Admin seed | `battlestack db:seed` (runs `server/database/seed.ts`: admin + reference data) | manual only, via `seed.mjs`, gated by `SEED_ALLOW_PRODUCTION` |',
                    '',
                    '### Shipping a schema change to production',
                    '',
                    '1. Edit `server/database/schema/*.ts`',
                    '2. `battlestack db:generate` (or `pnpm run db:generate`): drizzle-kit emits a new `NNNN_*.sql` file in `server/database/migrations/`',
                    '3. Review + commit the SQL file and the updated `meta/_journal.json`',
                    '4. Push: your deploy pipeline builds the image (bundles `tools/migrate.mjs` + the migrations dir into `/app/server/`)',
                    '5. Your deploy platform rolls the new image; the `migrate` step applies the new migration before the app starts',
                    '   (a deploy-target plugin, if you have one, documents the exact rollout mechanics)',
                    '',
                    '`migrate.mjs` is idempotent: applied migrations are tracked in `drizzle.__drizzle_migrations`',
                    'so reruns are no-ops. Compatible with `drizzle-kit migrate` if you ever want to run it directly.',
                    '',
                    'Push-vs-migrate drift is auto-baselined: if the journal is empty but the schema already has',
                    'tables (synced via `db:push` before migrations existed), both the boot migrator and `migrate.mjs`',
                    'record the committed migrations as applied instead of replaying them: no DDL runs, no data touched.',
                    '',
                    '### Migrate on boot',
                    '',
                    '`server/plugins/00-db-migrate-on-boot.ts` applies pending migrations every time the',
                    'server boots (the same way under `nuxt dev` and in the production container), guarded',
                    'by a Postgres advisory lock so only one process migrates at a time (multi-replica',
                    'rollouts block, then no-op). It locates the SQL files at `server/database/migrations`',
                    'in dev and `/app/migrations` in the container. Set `NUXT_DISABLE_DB_MIGRATE_ON_BOOT=true`',
                    'on read-only replicas pointed at a follower.',
                    '',
                    '### Reference-data seeds (non-admin)',
                    '',
                    '`seed.mjs` in the runtime image handles ONLY the admin bootstrap (raw SQL, no TS runtime needed).',
                    'Reference-data seeds (`server/database/seeds/NNN-*.ts` from features like `nuxt4:prompts`,',
                    '`nuxt4:mastra-admin`) only run via `battlestack db:seed` in the app container; they need the full',
                    'Nitro alias resolution. For production rollouts run `battlestack db:seed` as a one-shot job (or',
                    'exec into the running container) after the initial deploy.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    collectEnv(ctx): EnvVar[] {
        const adminEmail = String(ctx.state.adminEmail ?? `admin@${ctx.projectName}.com`)
        const adminPassword = String(ctx.state.adminPassword ?? '')

        const dbPort = allocatePort(ctx.projectName, 'db')

        return [
            { key: 'DB_NAME', value: 'app', group: 'Database' },
            {
                key: 'DB_PORT',
                value: String(dbPort),
                example: '5432',
                group: 'Database',
                description: 'Host port mapped to postgres in docker-compose. Per-project to avoid collisions.',
            },
            {
                key: 'NUXT_DATABASE_URL',
                value: `postgres://postgres:postgres@localhost:${dbPort}/app`,
                example: 'postgres://postgres:postgres@localhost:5432/app',
                group: 'Database',
            },
            {
                key: 'SEED_ADMIN_EMAIL',
                value: adminEmail,
                example: 'admin@example.com',
                group: 'Seed',
                description: 'Used once by db:seed to create the initial admin.',
            },
            {
                key: 'SEED_ADMIN_PASSWORD',
                value: adminPassword,
                example: 'replace-me',
                group: 'Seed',
                secret: true,
            },
        ]
    },

    async execute(ctx) {
        if (!ctx.state.adminEmail) ctx.state.adminEmail = `admin@${ctx.projectName}.com`
        if (!ctx.state.adminPassword) {
            ctx.state.adminPassword = randomBytes(12).toString('hex')
        }

        await emitTemplate(ctx, 'nuxt4:database', import.meta.url, 'database')

        await emitCompose(ctx)

        await registerRuntimeConfig(ctx.projectDir)

        const pkgPath = path.join(ctx.projectDir, 'package.json')
        const pkg = await readJson<Record<string, unknown>>(pkgPath)
        const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
        scripts['db:generate'] = 'drizzle-kit generate'
        scripts['db:push'] = 'drizzle-kit push'
        scripts['db:migrate'] = 'drizzle-kit migrate'
        scripts['db:studio'] = 'drizzle-kit studio'
        scripts['db:seed'] = 'tsx server/database/seed.ts'
        pkg.scripts = scripts
        await writeJson(pkgPath, pkg)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, 'nuxt4:database', import.meta.url, 'database', prev)
        await emitCompose(ctx)
        await registerRuntimeConfig(ctx.projectDir)
        report.written.push(COMPOSE_FILE)
        return report
    },

    projectCommands(): Record<string, ProjectCommand> {
        const docker = (args: string[]) => async (ctx: RunContext) => {
            const passthrough = ctx.state.passthrough ?? []
            await run('docker', ['compose', ...args, ...passthrough], {
                cwd: ctx.projectDir,
                inherit: true,
            })
        }
        const dockerDown = async (ctx: RunContext): Promise<void> => {
            const passthrough = ctx.state.passthrough ?? []
            const extra = ctx.state.volumes ? ['-v'] : []
            await run('docker', ['compose', 'down', ...extra, ...passthrough], {
                cwd: ctx.projectDir,
                inherit: true,
            })
        }
        const projectPM = (ctx: RunContext) =>
            resolveProjectPM({
                projectDir: ctx.projectDir,
                fallback: String(ctx.state.packageManager ?? 'pnpm'),
            })
        const pmRun = (script: string) => async (ctx: RunContext) => {
            const pm = await projectPM(ctx)
            await run(pm, ['run', script], { cwd: ctx.projectDir, inherit: true })
        }
        const dbApply = async (ctx: RunContext): Promise<void> => {
            const ready = await waitForPgReady(ctx.projectDir)
            if (!ready) {
                throw new Error(
                    'postgres did not become ready within 30s. Start it with `battlestack db:up`',
                )
            }
            await applyDbExtensions(ctx.projectDir)
            const pm = await projectPM(ctx)
            // Committed SQL migrations when any exist, else db:push.
            const migrationsDir = path.join(
                ctx.projectDir,
                'server',
                'database',
                'migrations',
            )
            const { readdir } = await import('node:fs/promises')
            const sqlFiles = await readdir(migrationsDir)
                .then((entries) => entries.filter((e) => e.endsWith('.sql')))
                .catch(() => [] as string[])
            if (sqlFiles.length > 0) {
                await run(pm, ['run', 'db:migrate'], {
                    cwd: ctx.projectDir,
                    inherit: true,
                })
            } else {
                await run(pm, ['run', 'db:push'], { cwd: ctx.projectDir, inherit: true })
            }
        }
        const dbUp = async (ctx: RunContext): Promise<void> => {
            try {
                await docker(['up', '-d'])(ctx)
            } catch (err) {
                // The real error is already on screen; this adds a docker-aware hint.
                throw new CLIError(
                    ErrorCode.DOCKER_FAILED,
                    'docker compose up failed (see output above).',
                    err,
                )
            }
            await dbApply(ctx)
        }

        return {
            'db:up': { label: 'Start postgres + apply schema (docker compose + db:push)', run: dbUp },
            'db:down': { label: 'Stop postgres (-v to drop volumes)', run: dockerDown },
            'up': { label: 'Alias for db:up', run: dbUp },
            'down': { label: 'Alias for db:down (-v to drop volumes)', run: dockerDown },
            'db:logs': { label: 'Tail postgres logs', run: docker(['logs', '-f']) },
            'db:psql': {
                label: 'Open psql shell',
                run: docker(['exec', '-it', 'db', 'psql', '-U', 'postgres', '-d', 'app']),
            },
            'db:push': {
                label: 'drizzle-kit push (apply schema; runs extensions/*.sql first)',
                run: async (ctx: RunContext) => {
                    const ready = await waitForPgReady(ctx.projectDir)
                    if (!ready) {
                        throw new Error(
                            'postgres did not become ready within 30s. Start it with `battlestack db:up`',
                        )
                    }
                    await applyDbExtensions(ctx.projectDir)
                    const pm = await projectPM(ctx)
                    await run(pm, ['run', 'db:push'], { cwd: ctx.projectDir, inherit: true })
                },
            },
            'db:generate': { label: 'drizzle-kit generate (new migration)', run: pmRun('db:generate') },
            'db:migrate': { label: 'drizzle-kit migrate (apply migrations)', run: pmRun('db:migrate') },
            'db:studio': { label: 'drizzle-kit studio (browser UI)', run: pmRun('db:studio') },
            'db:seed': {
                label: 'Run all seeds (idempotent; auto-ensures pg + schema first)',
                async run(ctx: RunContext) {
                    const ready = await waitForPgReady(ctx.projectDir)
                    if (!ready) {
                        throw new Error(
                            'postgres did not become ready within 30s. Start it with `battlestack db:up`',
                        )
                    }
                    await applyDbExtensions(ctx.projectDir)
                    const pm = await projectPM(ctx)
                    await run(pm, ['run', 'db:push'], {
                        cwd: ctx.projectDir,
                        inherit: true,
                    })
                    await run(pm, ['run', 'db:seed'], {
                        cwd: ctx.projectDir,
                        inherit: true,
                    })
                    const dbFqid = ctx.registries.features.get('nuxt4:database').fqid
                    await markDatabaseSeeded(ctx.projectDir, dbFqid)
                },
            },
            'db:fresh': {
                label: 'Drop the postgres volume + re-push schema (add --seed to also seed; --force to skip prompt)',
                async run(ctx: RunContext) {
                    if (!ctx.state.force) {
                        ui.fail('db:fresh is destructive: it drops the postgres volume and ALL data')
                        ui.dim('  Re-run with --force to confirm:')
                        ui.kv(
                            [
                                ['battlestack db:fresh --force', 'drop + push'],
                                ['battlestack db:fresh --force --seed', 'drop + push + seed'],
                            ],
                            '    ',
                        )
                        process.exit(1)
                    }
                    const pm = await projectPM(ctx)
                    await run('docker', ['compose', 'down', '-v'], {
                        cwd: ctx.projectDir,
                        inherit: true,
                    })
                    await run('docker', ['compose', 'up', '-d'], {
                        cwd: ctx.projectDir,
                        inherit: true,
                    })
                    const ready = await waitForPgReady(ctx.projectDir)
                    if (!ready) {
                        throw new Error('postgres did not become ready within 30s')
                    }
                    await applyDbExtensions(ctx.projectDir)
                    await run(pm, ['run', 'db:push'], {
                        cwd: ctx.projectDir,
                        inherit: true,
                    })
                    if (ctx.state.seed) {
                        await run(pm, ['run', 'db:seed'], {
                            cwd: ctx.projectDir,
                            inherit: true,
                        })
                    }
                },
            },
        }
    },
}
