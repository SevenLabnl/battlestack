import path from 'node:path'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import {
    allocatePort,
    CLIError,
    ensureHostsEntry,
    ensureWorkspaceMarker,
    ErrorCode,
    exists,
    getHostServices,
    hasMkcert,
    isFeatureEnabled,
    isPortFree,
    readLocalState,
    resolveAppPort,
    resolvePort,
    resolveProjectPM,
    run,
    supportsGateway,
    supportsHostsFile,
    dlxArgs,
    dlxBinary,
    parseIgnoredBuilds,
    resolveSpawn,
    writeWorkspaceReleaseAge,
    RELEASE_AGE_SCAFFOLD_DAYS,
    STAGE,
    type Feature,
    type PackageManager,
    type RunContext,
} from '@battlestack/core'
import { readDotEnv } from '@battlestack/core/utils/dotenv.js'
import { usersTablePopulated } from '@battlestack/core/utils/db.js'
import { describePortAttribution, diagnosePort } from '@battlestack/core/utils/port-diagnosis.js'
import { ui } from '@battlestack/tui'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { isDatabaseSeeded, markDatabaseSeeded } from './database.js'

/** Single-shot `nuxi init` with the union of every enabled feature's modules. */
export const scaffoldFeature: Feature = {
    id: 'nuxt4:scaffold',
    version: '1.2.0',
    label: 'Scaffold Nuxt project',
    frameworks: ['nuxt4'],
    stage: STAGE.SCAFFOLD,
    // One-time `nuxi init` only. Dep aggregation lives in `shared:install`.
    upgradable: false,

    collectEnv(ctx) {
        const appPort = allocatePort(ctx.projectName, 'app')
        return [
            {
                key: 'NUXT_PORT',
                value: String(appPort),
                example: '3000',
                group: 'App',
                description:
                    'Dev/preview server port. Per-project to avoid collisions when running multiple battlestack projects side-by-side.',
            },
        ]
    },

    projectCommands() {
        const projectPM = async (ctx: RunContext): Promise<string> =>
            resolveProjectPM({
                projectDir: ctx.projectDir,
                fallback: String(ctx.state.packageManager ?? 'pnpm'),
            })

        return {
            dev: {
                label: 'Start Nuxt dev server',
                async run(ctx: RunContext) {
                    const pm = await projectPM(ctx)
                    // A missing `.env` means a never-bootstrapped checkout.
                    if (!(await exists(path.join(ctx.projectDir, '.env')))) {
                        const { bootstrapProject } = getHostServices()
                        if (bootstrapProject) {
                            ui.warn('No .env found. Running `battlestack install` first (fresh checkout).')
                            await bootstrapProject(ctx, pm as PackageManager, { includeDb: false })
                        } else {
                            await ensureEnvFile(ctx)
                        }
                    } else {
                        await ensureEnvFile(ctx)
                    }
                    if (isFeatureEnabled(ctx, 'nuxt4:database')) {
                        // `ensureDbReady` makes a real connection, not a port probe.
                        const dbOk = await ensureDbReady(ctx)
                        if (dbOk) {
                            await ensureFirstTimeSeed(ctx, pm)
                        } else {
                            const dbPort = await resolvePort(ctx.projectDir, ctx.projectName, 'db')
                            throw new CLIError(
                                ErrorCode.EXEC_FAILED,
                                `Database setup failed (Postgres expected on localhost:${dbPort}). See `
                                + `the error above. Run \`battlestack up\` to fix it (often Docker), then re-run `
                                + `\`battlestack dev\`. Booting without it would crash with repeated ECONNREFUSED.`,
                            )
                        }
                    }
                    const gatewayOn = await ensureGatewayRoute(ctx)
                    // NUXT_HOST=0.0.0.0 when the gateway is on, reachable via host.docker.internal.
                    const port = await resolveAppPort(ctx.projectDir, ctx.projectName)
                    // A taken dedicated port is fatal.
                    if (!(await isPortFree(port))) {
                        const diagnosis = await diagnosePort(port, { expectedComposeProject: ctx.projectName })
                        const evidence = describePortAttribution(diagnosis.attribution)
                        if (diagnosis.attribution.kind === 'docker' && diagnosis.attribution.relation === 'own') {
                            throw new CLIError(
                                ErrorCode.PORT_IN_USE,
                                `Port ${port} (${evidence}) is already up. Open http://localhost:${port}, `
                                + `or run \`battlestack down\` first if you want to restart it.`,
                            )
                        }
                        throw new CLIError(
                            ErrorCode.PORT_IN_USE,
                            `Port ${port} is already in use by ${evidence}. If that's this project's own `
                            + `dev server, open http://localhost:${port} instead of starting a new one; `
                            + `otherwise stop it first. (This port is fixed per project; the dev server `
                            + `must bind it so \`battlestack login\` can reach it.)`,
                        )
                    }
                    // `.env` wins over inherited shell exports.
                    const env: Record<string, string> = {}
                    const shadowed: string[] = []
                    for (const [k, v] of await readDotEnv(ctx.projectDir)) {
                        env[k] = v
                        if (process.env[k] !== undefined && process.env[k] !== v) shadowed.push(k)
                    }
                    if (shadowed.length > 0) {
                        ui.warn(
                            `Shell env shadows .env for: ${shadowed.join(', ')}; using the .env value `
                            + `for \`battlestack dev\`. \`unset\` them in your shell to silence this.`,
                        )
                    }
                    env.NUXT_PORT = String(port)
                    if (gatewayOn) env.NUXT_HOST = '0.0.0.0'
                    await run(pm, ['run', 'dev'], {
                        cwd: ctx.projectDir,
                        inherit: true,
                        env,
                    })
                },
            },
            build: {
                label: 'Build for production',
                async run(ctx: RunContext) {
                    const pm = await projectPM(ctx)
                    await run(pm, ['run', 'build'], { cwd: ctx.projectDir, inherit: true })
                },
            },
            preview: {
                label: 'Preview production build',
                async run(ctx: RunContext) {
                    const pm = await projectPM(ctx)
                    await run(pm, ['run', 'preview'], { cwd: ctx.projectDir, inherit: true })
                },
            },
            prepare: {
                label: 'nuxt prepare (regenerate types)',
                async run(ctx: RunContext) {
                    const pm = await projectPM(ctx)
                    await run(pm, ['run', 'postinstall'], { cwd: ctx.projectDir, inherit: true })
                },
            },
        }
    },

    async execute(ctx) {
        const pm = ctx.state.packageManager ?? 'pnpm'
        const allModules = aggregateModules(ctx)
        // Subpath specs get a direct nuxt.config patch. Bare specs run after init.
        const bareModules = allModules.filter((m) => !isSubpathModule(m))
        const subpathModules = allModules.filter((m) => isSubpathModule(m))
        const nuxiTemplate = String(ctx.state.nuxiTemplate ?? 'minimal')

        // Stage 1: `nuxi init`. An empty `--modules=` suppresses the post-init prompt.
        const nuxiArgs: string[] = [
            'nuxi@latest',
            'init',
            ctx.projectDir,
            '--force',
            '--template',
            nuxiTemplate,
            '--packageManager',
            pm,
            '--no-gitInit',
            '--modules=',
        ]
        // An explicit release-age policy of 0, seeded before nuxi's embedded install.
        if (pm === 'pnpm') {
            await writeWorkspaceReleaseAge(ctx.projectDir, RELEASE_AGE_SCAFFOLD_DAYS)
        }

        const dlxBin = dlxBinary(pm)
        const verbose = ctx.state.verbose === true
        await runNuxiStage(dlxBin, dlxArgs(pm, nuxiArgs), verbose, ctx.projectDir, {
            checkNuxtInstalled: true,
            isPnpm: pm === 'pnpm',
        })
        if (pm === 'pnpm') await approveBuilds(ctx.projectDir, verbose)

        // Stage 2: `nuxi module add` for bare modules, against the now-installed Nuxt.
        if (bareModules.length > 0) {
            const addArgs = ['nuxi@latest', 'module', 'add', '--cwd', ctx.projectDir, ...bareModules]
            await runNuxiStage(dlxBin, dlxArgs(pm, addArgs), verbose, ctx.projectDir, {
                checkNuxtInstalled: false,
                isPnpm: pm === 'pnpm',
            })
            if (pm === 'pnpm') await approveBuilds(ctx.projectDir, verbose)

            // `nuxi module add` exits 0 even when its install failed, so verify here.
            const missing = await missingFromPackageJson(ctx.projectDir, bareModules)
            if (missing.length > 0) {
                throw new CLIError(
                    ErrorCode.EXEC_FAILED,
                    `nuxi module add did not install: ${missing.join(', ')}. `
                    + 'Its embedded package-manager call failed; re-run with --verbose to see why '
                    + '(common causes: a registry/network error, or a release-age policy rejecting '
                    + 'a freshly published module version).',
                )
            }
        }

        await patchNuxtConfig(ctx.projectDir, (c) => {
            // `addModule` is idempotent.
            for (const m of bareModules) c.addModule(m)
            for (const m of subpathModules) c.addModule(m)
            c.addViteOptimizeIncludes(['@vue/devtools-core', '@vue/devtools-kit'])
        })

        // package.json deps and the final install happen in `shared:install` at FINALIZE.
    },
}

interface RunResult {
    code: number
    output: string
}

/** Bare modules from `nuxi module add` that did not land in package.json deps. */
export async function missingFromPackageJson(projectDir: string, modules: string[]): Promise<string[]> {
    const fsp = await import('node:fs/promises')
    try {
        const pkg = JSON.parse(
            await fsp.readFile(path.join(projectDir, 'package.json'), 'utf8'),
        ) as { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
        const present = new Set([
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.devDependencies ?? {}),
        ])
        return modules.filter((m) => !present.has(m))
    } catch {
        return modules
    }
}

async function runNuxiStage(
    command: string,
    args: string[],
    verbose: boolean,
    projectDir: string,
    opts: { checkNuxtInstalled: boolean, isPnpm: boolean },
): Promise<void> {
    const fsp = await import('node:fs/promises')

    const nuxtInstalled = async (): Promise<boolean> =>
        fsp.access(path.join(projectDir, 'node_modules', 'nuxt'))
            .then(() => true)
            .catch(() => false)

    let result = await runFiltered(command, args, verbose)

    // pnpm only: the marker anchors pnpm here. npm and bun scaffolds never gain the yaml.
    if (opts.isPnpm && result.code === 0 && opts.checkNuxtInstalled && !(await nuxtInstalled())) {
        ui.dim(`pnpm install silently no-op'd (parent workspace); adding marker, retrying`)
        await ensureWorkspaceMarker(projectDir)
        await fsp.rm(path.join(projectDir, 'node_modules'), { recursive: true, force: true })
        await fsp.rm(path.join(projectDir, 'pnpm-lock.yaml'), { force: true })
        result = await runFiltered(command, args, verbose)
    }

    if (result.code !== 0) {
        if (parseIgnoredBuilds(result.output).length > 0) {
            // Deps are installed; only build scripts were skipped.
            ui.dim(`pnpm flagged ignored build scripts; will approve next`)
            return
        }
        const tail = result.output.trim().split(/\r?\n/).slice(-20).join('\n')
        throw new CLIError(
            ErrorCode.EXEC_FAILED,
            `${command} ${args.join(' ')} exited with code ${result.code}\n${tail}`,
        )
    }

    if (opts.checkNuxtInstalled && !(await nuxtInstalled())) {
        throw new CLIError(
            ErrorCode.EXEC_FAILED,
            `${command} ${args.join(' ')} succeeded but deps did not land in node_modules (workspace pull-up persisted)`,
        )
    }
}

/** Runs `pnpm approve-builds --all`. Requires the marker yaml, and runs for pnpm only. */
async function approveBuilds(projectDir: string, verbose: boolean): Promise<void> {
    await ensureWorkspaceMarker(projectDir)
    const result = await runFiltered('pnpm', ['approve-builds', '--all'], verbose, projectDir)
    if (result.code !== 0) {
        const tail = result.output.trim().split(/\r?\n/).slice(-20).join('\n')
        throw new CLIError(
            ErrorCode.EXEC_FAILED,
            `pnpm approve-builds --all exited with code ${result.code}\n${tail}`,
        )
    }
}

/** Runs nuxi and its child installer. Quiet swallows output; verbose streams it filtered. */
async function runFiltered(
    command: string,
    args: string[],
    verbose: boolean,
    cwd?: string,
): Promise<RunResult> {
    if (!verbose) return runQuiet(command, args, cwd)
    return ui.withSpinnerPaused(() => runVerbose(command, args, cwd))
}

function runQuiet(command: string, args: string[], cwd?: string): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        let resolved: ReturnType<typeof resolveSpawn>
        try {
            resolved = resolveSpawn(command, args, { cwd })
        } catch (err) {
            reject(new CLIError(ErrorCode.EXEC_FAILED, (err as Error).message, err))
            return
        }
        // stdin = 'ignore' so nuxi's post-init "browse modules?" prompt reads
        // EOF and falls through to the "No" default instead of hanging.
        const child = spawn(resolved.file, resolved.args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: resolved.shell,
            windowsVerbatimArguments: resolved.windowsVerbatimArguments,
            cwd,
        })
        let captured = ''
        child.stdout?.on('data', (b: Buffer) => (captured += b.toString()))
        child.stderr?.on('data', (b: Buffer) => (captured += b.toString()))
        child.on('error', (err) =>
            reject(new CLIError(ErrorCode.EXEC_FAILED, `Failed to spawn ${command}`, err)),
        )
        child.on('close', (code) => {
            resolve({ code: code ?? -1, output: captured })
        })
    })
}

function runVerbose(command: string, args: string[], cwd?: string): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        let resolved: ReturnType<typeof resolveSpawn>
        try {
            resolved = resolveSpawn(command, args, { cwd })
        } catch (err) {
            reject(new CLIError(ErrorCode.EXEC_FAILED, (err as Error).message, err))
            return
        }
        // stdin = 'ignore' so nuxi's post-init "browse modules?" prompt reads
        // EOF and falls through to the "No" default instead of hanging.
        const child = spawn(resolved.file, resolved.args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: resolved.shell,
            windowsVerbatimArguments: resolved.windowsVerbatimArguments,
            cwd,
        })
        let captured = ''
        let suppressing = false

        const filterLine = (line: string): boolean => {
            // eslint-disable-next-line no-control-regex -- strip ANSI escape sequences
            const plain = line.replaceAll(/\x1b\[[0-9;]*m/g, '')
            if (suppressing) {
                if (/╰─+╯/.test(plain)) suppressing = false
                return false
            }
            if (/👉\s*Next steps/.test(plain)) {
                suppressing = true
                return false
            }
            // pnpm chatter: WARN and ERR are kept.
            if (/^\s*Progress:\s/.test(plain)) return false
            if (/^\s*Packages:\s/.test(plain)) return false
            if (/^\s*Done in\s/.test(plain)) return false
            if (/^\s*Already up to date\b/.test(plain)) return false
            if (/^\s*\++\s*$/.test(plain)) return false
            if (plain.startsWith('DeprecationWarning:')) return false
            if (/url\.parse\(\) behavior is not standardized/.test(plain)) return false
            if (/Use `node --trace-deprecation/.test(plain)) return false
            if (/\[nuxt-i18n\]\s+WARN\s+The prefix_except_default i18n strategy/.test(plain)) {
                return false
            }
            if (/If you have \.eslintrc or \.eslintignore files/.test(plain)) {
                return false
            }
            return true
        }

        const pipe = (stream: NodeJS.ReadableStream, sink: NodeJS.WriteStream) => {
            let buf = ''
            stream.on('data', (chunk: Buffer) => {
                const text = chunk.toString()
                captured += text
                buf += text
                let idx
                while ((idx = buf.indexOf('\n')) !== -1) {
                    const line = buf.slice(0, idx)
                    buf = buf.slice(idx + 1)
                    if (filterLine(line)) sink.write(line + '\n')
                }
            })
            stream.on('end', () => {
                if (buf && filterLine(buf)) sink.write(buf)
            })
        }
        if (child.stdout) pipe(child.stdout, process.stdout)
        if (child.stderr) pipe(child.stderr, process.stderr)

        child.on('error', (err) =>
            reject(new CLIError(ErrorCode.EXEC_FAILED, `Failed to spawn ${command}`, err)),
        )
        child.on('close', (code) => {
            resolve({ code: code ?? -1, output: captured })
        })
    })
}

// Registers the project with the battlestack gateway when the manifest opts in.
async function ensureGatewayRoute(ctx: RunContext): Promise<boolean> {
    if (!supportsGateway()) {
        return false
    }
    if (!(await hasMkcert())) {
        if (ctx.debug) ui.debug('gateway skipped (mkcert not installed)')
        return false
    }
    const local = await readLocalState(ctx.projectDir)
    const gateway = local?.gateway
    if (!gateway || gateway.enabled === false) return false

    const { gatewayUp, registerProject } = getHostServices()
    if (!gatewayUp || !registerProject) {
        if (ctx.debug) ui.debug('gateway skipped (host services not installed)')
        return false
    }

    try {
        await patchNuxtConfig(ctx.projectDir, (c) => c.addViteAllowedHosts(['.battlestack.test']))
    } catch (err) {
        if (ctx.debug) ui.debug(`could not patch vite.server.allowedHosts: ${(err as Error).message ?? err}`)
    }

    const hostname = gateway.hostname ?? `${ctx.projectName}.battlestack.test`
    const port = await resolveAppPort(ctx.projectDir, ctx.projectName)

    try {
        const fs = await import('node:fs/promises')
        const pathMod = await import('node:path')
        const osMod = await import('node:os')

        await gatewayUp()
        await registerProject(ctx.projectName, hostname, port)

        if (supportsHostsFile()) {
            try {
                const added = await ensureHostsEntry({ ip: '127.0.0.1', hostname })
                if (added) ui.ok(`Added ${hostname} to hosts file`)
            } catch (err) {
                ui.warn(`could not edit hosts file; add manually: \`127.0.0.1 ${hostname}\``)
                if (ctx.debug) console.error(err)
            }
        } else {
            ui.dim(`(Linux / unsupported OS; add to /etc/hosts manually: \`127.0.0.1 ${hostname}\`)`)
        }

        // TLS is on whenever `_tls.yml` exists alongside the dynamic configs.
        const tlsMarker = pathMod.join(osMod.homedir(), '.battlestack', 'gateway', 'dynamic', '_tls.yml')
        const hasTls = await fs
            .stat(tlsMarker)
            .then(() => true)
            .catch(() => false)
        const scheme = hasTls ? 'https' : 'http'

        ui.blank()
        ui.kv([
            ['open', ui.color.accent(`${scheme}://${hostname}`)],
            ['fallback', `http://localhost:${port}  ${ui.color.dim('(direct)')}`],
        ])
        ui.blank()
        return true
    } catch (err) {
        ui.warn(`gateway registration failed; falling back to localhost:${port}`)
        if (ctx.debug) console.error(err)
        return false
    }
}

/** Recreates `.env` from feature `collectEnv()` when missing. */
async function ensureEnvFile(ctx: RunContext): Promise<void> {
    const envPath = path.join(ctx.projectDir, '.env')
    try {
        await access(envPath)
        return
    } catch {
        /* missing → fall through */
    }
    if (!ctx.registries.features.has('shared:env')) return
    ui.step('.env missing, generating from feature-declared vars')
    const env = ctx.registries.features.get('shared:env')
    if (env.execute) await env.execute(ctx)
}

/** Auto-runs `db:seed` on the first `battlestack dev`, gated by `nuxt4:database.state.seeded`. */
async function ensureFirstTimeSeed(ctx: RunContext, pm: string): Promise<void> {
    const dbFqid = ctx.registries.features.get('nuxt4:database').fqid
    if (await isDatabaseSeeded(ctx.projectDir, dbFqid)) {
        // The flag is trusted only when data actually exists.
        if (await usersTablePopulated(ctx.projectDir) !== false) return
        ui.warn('Manifest says seeded but the users table is empty (renamed project → fresh volume?), reseeding')
    }
    ui.step('First-time seed (writing admin user from SEED_* in .env)')
    try {
        await run(pm, ['run', 'db:seed'], { cwd: ctx.projectDir, inherit: true })
        await markDatabaseSeeded(ctx.projectDir, dbFqid)
    } catch (err) {
        ui.warn('First-time `db:seed` failed; run `battlestack db:seed` manually once fixed')
        if (ctx.debug) console.error(err)
    }
}

/** Delegates to `nuxt4:database`'s `up` command. Returns false on failure. */
async function ensureDbReady(ctx: RunContext): Promise<boolean> {
    const db = ctx.registries.features.get('nuxt4:database')
    const cmd = db.projectCommands?.(ctx)?.['up']
    if (!cmd) return false
    try {
        await cmd.run(ctx)
        return true
    } catch (err) {
        ui.warn('`battlestack up` failed; see the error above (run `battlestack up` directly for the full hint)')
        if (ctx.debug) console.error(err)
        return false
    }
}

// Subpath specs like `pinia-plugin-persistedstate/nuxt` fail the package-name regex nuxi uses.
function isSubpathModule(spec: string): boolean {
    if (spec.startsWith('@')) {
        const slashes = spec.split('/').length - 1
        return slashes > 1
    }
    return spec.includes('/')
}

function aggregateModules(ctx: RunContext): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of ctx.enabledFeatures) {
        const feature = ctx.registries.features.get(id)
        const mods = feature.collectModules?.(ctx) ?? []
        for (const m of mods ?? []) {
            if (!seen.has(m)) {
                seen.add(m)
                out.push(m)
            }
        }
    }
    return out
}
