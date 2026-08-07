import path from 'node:path'
import { createHmac } from 'node:crypto'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import {
    allocatePort,
    resolveAppPort,
    writeFileEnsured,
    hashFile,
    recordFile,
    openBrowser,
    CLIError,
    ErrorCode,
    isFeatureEnabled,
    STAGE,
} from '@battlestack/core'
import { readDotEnv } from '@battlestack/core/utils/dotenv.js'
import { ui } from '@battlestack/tui'
import type { EnvVar, Feature, ProjectCommand, RunContext } from '@battlestack/core'

function titleCase(slug: string): string {
    return slug
        .split(/[-_]+/)
        .filter(Boolean)
        .map((s) => s[0]!.toUpperCase() + s.slice(1))
        .join(' ')
}

/** Session auth on `nuxt-auth-utils`. The sealed cookie carries an opaque sessionId. */
export const authFeature: Feature = {
    id: 'nuxt4:auth',
    // 1.9.0: prod-only boot guard for NUXT_SESSION_PASSWORD.
    // 1.10.0: `rate-limit.ts`'s `store` binding is mutable and exported.
    version: '1.10.0',
    label: 'Session-based auth (argon2id)',
    frameworks: ['nuxt4'],
    stage: STAGE.AUTH,
    requires: ['nuxt4:database'],

    collectModules() {
        return ['nuxt-auth-utils']
    },

    collectDeps() {
        return {
            prod: ['zod@^4', '@node-rs/argon2', 'nodemailer'],
            dev: ['@types/nodemailer'],
        }
    },

    collectDocs() {
        return [
            {
                heading: 'Auth',
                body: [
                    'Session-based auth via `nuxt-auth-utils`. Argon2id password hashing via `@node-rs/argon2` (no Bun runtime required).',
                    '',
                    '- Login page: `/login`',
                    '- API: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`',
                    '- Composable: `useAuth()` (`login`, `logout`, `loggedIn`, `user`)',
                    '- Global middleware redirects unauthenticated visitors to `/login`',
                    '',
                    '**Sessions are DB-backed.** The cookie is just a sealed pointer to a `sessions` row (id, userId, expiresAt, lastSeenAt, userAgent, ip). The Nitro plugin at `server/plugins/session.ts` validates the row on every request and refreshes `lastSeenAt`. Revoke any session by `DELETE FROM sessions WHERE id = ...`; the cookie becomes immediately invalid.',
                    '',
                    'Other login flows (passkey, oauth, 2fa challenge) all call `createDbSession(userId, event)` from `server/utils/auth.ts` and pass the returned id as `secure.sessionId` to `setUserSession`. Skipping that step results in a cookie-only session that the fetch hook ignores.',
                    '',
                    '### Dev login shortcut',
                    '',
                    '- `battlestack login` opens a magic link for the seed admin in the OS browser (uses `SEED_ADMIN_EMAIL` from `.env`) and prints it to the terminal. Works under WSL/WSL2 via `wslview` or PowerShell interop.',
                    '- `battlestack login --no-browser` prints the link only (for SSH sessions without a browser).',
                    '- `battlestack login other@example.com` does the same for any user that already exists in the DB.',
                    '- `battlestack uli` is a short alias (Drush muscle memory).',
                    '',
                    'Mechanism: CLI builds an HMAC-signed token with the same `NUXT_SESSION_PASSWORD` that seals session cookies and opens `/auth/magic-login?token=…&sig=…` on the running dev server. The Nuxt page (`app/pages/auth/magic-login.vue`) POSTs the token to `/api/auth/magic-login`, which verifies the HMAC, calls `createDbSession`, and sets the session cookie; the page then client-side navigates to `/dashboard`. The endpoint stacks two guards (`NODE_ENV !== \'production\'` AND the request `host` header must resolve to a local hostname: `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, `*.local`, or `*.battlestack.test`), so even a dev-tagged server tunnelled through ngrok or exposed publicly returns 404. Tokens expire after 60 seconds.',
                    '',
                    '### Self-service registration',
                    '',
                    'Registration is **off by default**. Both `/signup` and `POST /api/auth/signup` return 404 until you flip `NUXT_PUBLIC_ALLOW_REGISTRATION=true` (or set `runtimeConfig.public.allowRegistration: true` in `nuxt.config.ts`). The login page hides the "Create account" link automatically when the flag is off.',
                    '',
                    'Until you flip it, the only path to a working account is `battlestack db:seed` (admin from `SEED_ADMIN_*`) or an admin manually creating users via `/dashboard/users`.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    collectEnv(ctx): EnvVar[] {
        return [
            {
                key: 'NUXT_SESSION_PASSWORD',
                generate: { bytes: 32, encoding: 'hex' },
                group: 'Session',
                description: 'Used by nuxt-auth-utils to seal session cookies. Must be ≥ 32 chars.',
                secret: true,
            },
            {
                key: 'NUXT_ALLOWED_ORIGINS',
                example: 'https://app.example.com,https://admin.example.com',
                group: 'Security',
                description:
                    'Comma-separated origin allowlist for mutating requests (server/middleware/01.origin-check.ts). Empty in dev = allow all.',
            },
            {
                key: 'NUXT_RATE_LIMIT_DISABLED',
                value: 'true',
                example: 'false',
                group: 'Security',
                description:
                    'Dev-only opt-out for the (Postgres-backed, cross-replica) rate limiter so `battlestack test` / e2e runs don\'t exhaust the 10-attempt LOGIN bucket on the first run. **Never set on a production deployment**: it removes brute-force protection.',
            },
            {
                key: 'NUXT_SMTP_HOST',
                value: 'localhost',
                example: 'smtp.mandrillapp.com',
                group: 'Email',
                description:
                    'SMTP host. Defaults to the per-project Mailpit container (started by `battlestack up`). Switch to Mandrill or another SMTP provider in production.',
            },
            {
                key: 'NUXT_SMTP_PORT',
                value: String(allocatePort(ctx.projectName, 'smtp')),
                example: '587',
                group: 'Email',
                description: 'Per-project host port for the project\'s Mailpit container.',
            },
            {
                key: 'SMTP_PORT',
                value: String(allocatePort(ctx.projectName, 'smtp')),
                example: '1025',
                group: 'Email',
                description: 'Dev-only: compose-side mirror of NUXT_SMTP_PORT, keeping docker-compose.yml and the Nuxt runtime in sync. Irrelevant in prod (real SMTP provider).',
            },
            {
                key: 'MAIL_UI_PORT',
                value: String(allocatePort(ctx.projectName, 'mail-ui')),
                example: '8025',
                group: 'Email',
                description: 'Dev-only: host port for the project\'s Mailpit web UI. Visit http://localhost:$MAIL_UI_PORT. Irrelevant in prod.',
            },
            {
                key: 'NUXT_SMTP_USERNAME',
                value: '',
                example: 'replace-me',
                group: 'Email',
                description: 'Empty for mailpit. Set when targeting a real SMTP provider.',
            },
            {
                key: 'NUXT_SMTP_PASSWORD',
                value: '',
                example: 'replace-me',
                group: 'Email',
                secret: true,
            },
            {
                key: 'NUXT_SMTP_FROM',
                value: `${titleCase(ctx.projectName)} <no-reply@${ctx.projectName}.com>`,
                example: 'Acme <no-reply@acme.com>',
                group: 'Email',
                description: 'RFC 5322 from-address. Display name + email. Override to a verified sender before production.',
            },
            {
                key: 'NUXT_PUBLIC_APP_URL',
                value: `http://localhost:${allocatePort(ctx.projectName, 'app')}`,
                example: 'http://localhost:3000',
                group: 'App',
                description: 'Base URL emitted in password-reset / verification email links. Override for prod / gateway hostname.',
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:auth', import.meta.url, 'auth')
        await postPatches(ctx.projectDir)
        await emitRecoveryHookStub(ctx)
        await emitAuditStub(ctx)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:auth', import.meta.url, 'auth', prev)
        await postPatches(ctx.projectDir)
        await emitRecoveryHookStub(ctx)
        await emitAuditStub(ctx)
        return result
    },

    projectCommands(): Record<string, ProjectCommand> {
        // Same command instance under both names.
        const login: ProjectCommand = {
            label: 'Open browser logged in as the seed admin (dev only)',
            description: 'Pass `<email>` as a positional to log in as a different user, e.g. `battlestack login other@example.com`.',
            run: runLogin,
        }
        return { login, uli: login }
    },
}

/** No-op stub at `server/utils/auth-recovery-signup-hook.ts` when `nuxt4:auth-recovery` is off. */
async function emitRecoveryHookStub(ctx: RunContext): Promise<void> {
    if (isFeatureEnabled(ctx, 'nuxt4:auth-recovery')) return
    const rel = 'server/utils/auth-recovery-signup-hook.ts'
    const body = [
        '// No-op stub emitted by `nuxt4:auth` when `nuxt4:auth-recovery` is disabled.',
        '// `signup.post.ts` dynamic-imports this path under a runtimeConfig flag;',
        '// the file must exist for Rollup to resolve the import at build time.',
        'export async function issueVerificationEmail(',
        '    _userId: string,',
        '    _email: string,',
        '    _locale: string | null = null,',
        '): Promise<void> {',
        '    // intentionally empty',
        '}',
        '',
    ].join('\n')
    const dest = path.join(ctx.projectDir, rel)
    await writeFileEnsured(dest, body)
    recordFile(ctx, 'nuxt4:auth', rel, await hashFile(dest))
}

/** No-op stub at `server/utils/audit.ts` when `nuxt4:audit-log` is off. */
async function emitAuditStub(ctx: RunContext): Promise<void> {
    if (isFeatureEnabled(ctx, 'nuxt4:audit-log')) return
    const rel = 'server/utils/audit.ts'
    const body = [
        'import type { H3Event } from \'h3\'',
        '',
        '// No-op stub emitted by `nuxt4:auth` when `nuxt4:audit-log` is disabled.',
        'export async function logAuditEvent(',
        '    _event: H3Event | null,',
        '    _action: string,',
        '    _userId: string | null,',
        '    _metadata?: Record<string, unknown>,',
        '): Promise<void> {',
        '    // intentionally empty',
        '}',
        '',
    ].join('\n')
    const dest = path.join(ctx.projectDir, rel)
    await writeFileEnsured(dest, body)
    recordFile(ctx, 'nuxt4:auth', rel, await hashFile(dest))
}

async function runLogin(ctx: RunContext): Promise<void> {
    const env = await readDotEnv(ctx.projectDir)
    if (env.size === 0) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No .env file in ${ctx.projectDir}. Run \`battlestack db:seed\` once to bootstrap.`,
        )
    }

    const positional = String(ctx.state.subcommandArg ?? '').trim().toLowerCase()
    const seedEmail = (env.get('SEED_ADMIN_EMAIL') ?? '').trim().toLowerCase()
    const targetEmail = positional || seedEmail
    if (!targetEmail) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'No login target. Pass an email as `battlestack login <email>` or set `SEED_ADMIN_EMAIL` in `.env`.',
        )
    }

    const secret = env.get('NUXT_SESSION_PASSWORD') ?? ''
    if (secret.length < 32) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'NUXT_SESSION_PASSWORD is missing or shorter than 32 chars in `.env`. Bump it and re-run.',
        )
    }

    const port = await resolveAppPort(ctx.projectDir, ctx.projectName)
    // Localhost, not `NUXT_HOST`, which is only the bind address.
    const baseUrl = `http://localhost:${port}`

    if (!(await isDevServerUp(baseUrl))) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Dev server not reachable at ${baseUrl} (this project's fixed port). `
            + `Start it with \`battlestack dev\` in another terminal, then re-run \`battlestack login\`. `
            + `If you launched it with a plain \`nuxt dev\` it may have bound a different `
            + `port (e.g. :3000); use \`battlestack dev\` so it binds :${port}.`,
        )
    }

    const exp = Math.floor(Date.now() / 1000) + 60
    const payload = Buffer.from(JSON.stringify({ email: targetEmail, exp })).toString('base64url')
    const sig = createHmac('sha256', secret).update(payload).digest('hex')

    const url = `${baseUrl}/auth/magic-login?token=${payload}&sig=${sig}`

    // Opens in the OS browser and prints the URL. `--no-browser` prints only.
    ui.step(`Magic link for ${targetEmail} (expires in 60 seconds)`)
    ui.kv([['open', ui.color.accent(url)]])
    if (ctx.state.browser === false) {
        ui.dim('  Print-only (--no-browser). Open the URL above manually.')
    } else {
        await openBrowser(url)
    }
}

/** Short-timeout HEAD probe of `/`. Any HTTP response means up; refused or timeout means down. */
async function isDevServerUp(baseUrl: string): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    try {
        const res = await fetch(`${baseUrl}/`, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'manual',
        })
        return res.status > 0
    } catch {
        return false
    } finally {
        clearTimeout(timer)
    }
}

// Pre-bundles zod on the client, forces Vite SSR to bundle it, and registers the SMTP keys.
async function postPatches(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) => {
        c.addViteOptimizeIncludes(['zod'])
        c.addViteSsrNoExternal(['zod'])
        c.mergeRuntimeConfig({
            smtpHost: '',
            smtpPort: '',
            smtpUsername: '',
            smtpPassword: '',
            smtpFrom: '',
            // Empty string, not `false`: `email.ts` distinguishes unset from an explicit false.
            smtpRequireTls: '',
            // Must be registered: `NUXT_ALLOWED_ORIGINS` only binds onto an existing key.
            allowedOrigins: '',
            // Must be registered: `NUXT_RATE_LIMIT_DISABLED` only binds onto an existing key.
            rateLimitDisabled: false,
        })
        c.mergeRuntimePublic({
            appUrl: '',
            // Closed by default: while `false`, `/signup` and `/api/auth/signup` return 404.
            allowRegistration: false,
        })
    })
}
