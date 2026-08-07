/**
 * Demo: run the CLI without the internal plugin (public user view), install it
 * into a throwaway plugin store (`battlestack plugin add`), run again (internal view),
 * remove it, run once more.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BATTLESTACK_HOME = mkdtempSync(path.join(os.tmpdir(), 'battlestack-home-'))
// Scratch dir for the `create` showcase — kept OUT of the repo tree (the
// scaffold guard refuses to write inside it) and torn down at the end. Runs
// use `--dry-run --yes` so the demo stays non-interactive and writes nothing
// real (no dep install, no file tree) while still exercising the full
// prompt/preflight/summary path through the ported `create` command.
const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'battlestack-scratch-'))
// The internal plugin lives in the separate PRIVATE battlestack-internal repo (the
// GitHub-org access gate). Default assumes a sibling checkout; override with
// BATTLESTACK_INTERNAL_PLUGIN. Run `pnpm install` there first so @battlestack/core resolves.
const INTERNAL_PLUGIN = process.env.BATTLESTACK_INTERNAL_PLUGIN
    ?? path.resolve(ROOT, '../battlestack-internal/plugin')
const INTERNAL_PLUGIN_PKG = path.join(INTERNAL_PLUGIN, 'package.json')
// No sibling checkout (the common case for anyone outside the org) — run the
// public-surface acts only instead of throwing partway through. The plugin's
// name is read from its own package.json below rather than hardcoded here, so
// `plugin remove` always matches whatever `plugin add` actually registered.
const HAS_INTERNAL_PLUGIN = existsSync(INTERNAL_PLUGIN_PKG)

function battlestack(...args: string[]): void {
    console.log(`\n$ battlestack ${args.join(' ')}`)
    execFileSync('pnpm', ['--silent', 'exec', 'tsx', 'packages/cli/src/index.ts', ...args], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, BATTLESTACK_HOME },
    })
}

try {
    console.log('════ 1. Public user — no internal plugin installed ════')
    battlestack('help')
    battlestack('features')
    battlestack('templates')
    battlestack('create', 'demo-public', 'nuxt4-fullstack', '--yes', '--dry-run', '--cwd', SCRATCH)
    battlestack('skills')

    if (HAS_INTERNAL_PLUGIN) {
        const internalName = JSON.parse(readFileSync(INTERNAL_PLUGIN_PKG, 'utf8')).name

        console.log(`\n════ 2. Internal engineer — battlestack plugin add ${internalName} ════`)
        battlestack('plugin', 'add', INTERNAL_PLUGIN)
        battlestack('plugins')
        battlestack('help')
        battlestack('features')
        battlestack('templates')
        battlestack('create', 'demo-internal', 'nuxt4-fullstack', '--yes', '--dry-run', '--cwd', SCRATCH)
        battlestack('deploy', 'production')
        battlestack('skills')

        console.log('\n════ 3. Plugin removed — back to public view ════')
        battlestack('plugin', 'remove', internalName)
        battlestack('help')
        battlestack('templates')
    } else {
        console.log(`\nNo internal plugin checkout at ${INTERNAL_PLUGIN} — skipping the internal-view sections.`)
    }
} finally {
    rmSync(BATTLESTACK_HOME, { recursive: true, force: true })
    rmSync(SCRATCH, { recursive: true, force: true })
}
