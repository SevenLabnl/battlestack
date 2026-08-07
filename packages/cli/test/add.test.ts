import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    CLIError,
    ErrorCode,
    MANIFEST_PATH,
    silentLoader,
    STAGE,
    writeManifest,
    writeRecorded,
    type BattlestackRegistries,
    type Feature,
    type ProjectManifest,
    type RunContext,
} from '@battlestack/core'
import { addCommand, removeCommand } from '../src/commands/add-remove.js'
import { pullCommand } from '../src/commands/pull.js'
import { buildRegistries, defaultArgs, withCwd, withCwdCapture } from './test-utils.js'

const NS = 'addtest'
const FW = 'add-fw'
const TPL = 'add-tpl'

async function fileExists(dir: string, rel: string): Promise<boolean> {
    try {
        await stat(path.join(dir, rel))
        return true
    } catch {
        return false
    }
}

/** Minimal installable feature: emits one recorded file named after its own id. */
function feature(id: string, extra: Partial<Feature> = {}): Feature {
    return {
        id,
        label: id,
        version: '1.0.0',
        stage: STAGE.STYLING,
        async execute(ctx) {
            await writeRecorded(ctx, id, `${id.replace(/:/g, '-')}.txt`, `${id}\n`)
        },
        ...extra,
    }
}

/**
 * Ids are authored BARE; `buildRegistries` finalizes them into namespaced fqids. That
 * divergence is what `add` must get right, and what a hand-written fixture cannot fake.
 */
function fixtures(): { registries: BattlestackRegistries, warnings: string[] } {
    return buildRegistries({
        namespace: NS,
        frameworks: [{
            id: FW,
            label: FW,
            supportedFeatures: [
                'add:base',
                'add:opt',
                'add:owning',
                'add:other-fw',
                'add:not-in-template',
                // Advertised but never registered. `supportedFeatures` is a catalog of
                // ids a project MAY carry, so this is a supported state, not a warning.
                'add:unregistered',
            ],
        }],
        features: [
            feature('add:base'),
            feature('add:opt'),
            feature('add:owning', {
                structuralFiles: () => ['add-owning.txt'],
            }),
            // Registered and advertised, but scoped to another framework.
            feature('add:other-fw', { frameworks: ['some-other-fw'] }),
            // Offered by the template but absent from `supportedFeatures`:
            // the framework check's real job.
            feature('add:not-advertised'),
            // Registered and advertised, but the template does not offer it.
            feature('add:not-in-template'),
        ],
        templates: [{
            id: TPL,
            label: TPL,
            framework: FW,
            requiredFeatures: ['add:base'],
            optionalFeatures: ['add:opt', 'add:owning', 'add:other-fw', 'add:not-advertised'],
        }],
    })
}

interface Project {
    dir: string
    registries: BattlestackRegistries
    warnings: string[]
    manifest(): Promise<ProjectManifest>
}

const dirs: string[] = []

/**
 * Scaffold a project carrying only the template's required feature, via the real
 * `writeManifest`, so on-disk records hold fqids rather than whatever this file typed.
 */
async function project(): Promise<Project> {
    const { registries, warnings } = fixtures()
    const dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-add-test-'))
    dirs.push(dir)

    const base = registries.features.get('add:base')
    const ctx: RunContext = {
        projectName: path.basename(dir),
        projectDir: dir,
        framework: registries.frameworks.get(FW),
        template: registries.templates.get(TPL),
        enabledFeatures: new Set([base.fqid]),
        state: { packageManager: 'pnpm', skipInstall: true },
        debug: false,
        dryRun: false,
        registries,
    }
    await base.execute(ctx)
    await writeManifest(ctx)

    return {
        dir,
        registries,
        warnings,
        async manifest() {
            return JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8')) as ProjectManifest
        },
    }
}

afterEach(async () => {
    while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
})

function add(featureId: string) {
    return (p: Project) =>
        addCommand(
            defaultArgs({ projectName: featureId, skipInstall: true }),
            undefined as never,
            p.registries,
        )
}

describe('the fixture really is in production shape', () => {
    // Guard on the guard: every test below is vacuous unless bare and fqid actually
    // DIFFER. Bare ids equalling fqids in test-world is what let past id bugs ship.
    it('stores fqids in the template feature lists, not the authored bare ids', async () => {
        const { registries } = fixtures()
        const tpl = registries.templates.get(TPL)
        expect(tpl.requiredFeatures).toEqual([`${NS}:add:base`])
        expect(tpl.optionalFeatures).toEqual([
            `${NS}:add:opt`,
            `${NS}:add:owning`,
            `${NS}:add:other-fw`,
            `${NS}:add:not-advertised`,
        ])
        expect(registries.features.get('add:opt').fqid).toBe(`${NS}:add:opt`)
    })

    it('finalizing produces no warnings: an advertised-but-unregistered id is a supported state', async () => {
        // `add:unregistered` has no feature behind it. Canonicalizing that field must
        // not turn the documented catalog shape into per-invocation warning noise.
        expect(fixtures().warnings).toEqual([])
    })
})

describe('battlestack add: accepts the ids the CLI itself reports', () => {
    let p: Project
    beforeEach(async () => {
        p = await project()
    })

    // `supportedFeatures` held bare ids and `optionalFeatures` fqids, both checked
    // against one input, so NO input satisfied both. Both spellings must work.
    it('adds an optional feature named by its bare authored id', async () => {
        await withCwd(p.dir, () => add('add:opt')(p))

        const ids = (await p.manifest()).features.map((f) => f.id)
        expect(ids).toContain(`${NS}:add:opt`)
    })

    it('adds an optional feature named by its fully-qualified id', async () => {
        await withCwd(p.dir, () => add(`${NS}:add:opt`)(p))

        const ids = (await p.manifest()).features.map((f) => f.id)
        expect(ids).toContain(`${NS}:add:opt`)
    })

    it('records the feature version and the files it emitted', async () => {
        await withCwd(p.dir, () => add('add:opt')(p))

        const rec = (await p.manifest()).features.find((f) => f.id === `${NS}:add:opt`)!
        expect(rec.version).toBe('1.0.0')
        // An empty `files` map is the silent-failure shape: the file was written but
        // the manifest lost it, so `pull`/`remove`/`doctor` treat it as untracked.
        expect(Object.keys(rec.files)).toEqual(['add-opt.txt'])
    })

    // The state bag is keyed by the feature's own BARE id, the string `execute()` passes
    // to `recordOwned`. Keying it off the user's input loses the other spelling.
    it('preserves structuralFiles ownership when the fqid is what the user typed', async () => {
        await withCwd(p.dir, () => add(`${NS}:add:owning`)(p))

        const rec = (await p.manifest()).features.find((f) => f.id === `${NS}:add:owning`)!
        expect(rec.ownedByUser).toEqual(['add-owning.txt'])
    })

    it('reports an already-installed feature named by the other spelling', async () => {
        await withCwd(p.dir, () => add('add:opt')(p))
        // The manifest holds the fqid; asking again by the BARE id must recognise it as
        // installed. A second install clobbers the hashes a user's edits are diffed against.
        const lines = await withCwdCapture(p.dir, () => add('add:opt')(p))

        expect(lines.join('\n')).toMatch(/already installed/)
        const matching = (await p.manifest()).features.filter((f) => f.id === `${NS}:add:opt`)
        expect(matching).toHaveLength(1)
    })

    // Each leg named by a DIFFERENT spelling. `pull` checks `optedOut` against the
    // template's fqid lists, so a bare entry there resurrects a removed feature.
    it('round-trips add → remove → add, mixing bare and fully-qualified spellings', async () => {
        await withCwd(p.dir, () => add('add:opt')(p))
        expect(await fileExists(p.dir, 'add-opt.txt')).toBe(true)

        await withCwd(p.dir, () =>
            removeCommand(
                defaultArgs({ projectName: `${NS}:add:opt`, skipInstall: true }),
                undefined as never,
                p.registries,
            ),
        )
        const removed = await p.manifest()
        expect(removed.features.map((f) => f.id)).not.toContain(`${NS}:add:opt`)
        expect(removed.optedOut).toContain(`${NS}:add:opt`)
        expect(await fileExists(p.dir, 'add-opt.txt')).toBe(false)

        await withCwd(p.dir, () => add(`${NS}:add:opt`)(p))
        const readded = await p.manifest()
        expect(readded.features.map((f) => f.id)).toContain(`${NS}:add:opt`)
        expect(readded.optedOut ?? []).not.toContain(`${NS}:add:opt`)
        expect(await fileExists(p.dir, 'add-opt.txt')).toBe(true)
    })

    // `remove` reached the manifest's fqid records with the user's raw input too, so a
    // bare-spelled removal reported "not installed" for a feature that plainly was.
    it('removes a feature named by its bare authored id', async () => {
        await withCwd(p.dir, () => add('add:opt')(p))
        await withCwd(p.dir, () =>
            removeCommand(
                defaultArgs({ projectName: 'add:opt', skipInstall: true }),
                undefined as never,
                p.registries,
            ),
        )

        expect((await p.manifest()).features.map((f) => f.id)).not.toContain(`${NS}:add:opt`)
    })
})

/**
 * `removeCommand` persisted the user's typed spelling into `optedOut` while `pull`
 * compares that list against the template's fqid lists, so a bare opt-out never matched.
 */
describe('battlestack remove → pull does not resurrect the feature', () => {
    it('records the fqid in optedOut, so a bare-id removal survives a pull', async () => {
        // `add:base` is the REQUIRED feature deliberately: `pull` only rehydrates
        // `template.requiredFeatures`, so an optional one never reaches the opt-out check.
        const p = await project()
        expect(await fileExists(p.dir, 'add-base.txt')).toBe(true)

        await withCwd(p.dir, () =>
            removeCommand(
                defaultArgs({ projectName: 'add:base', skipInstall: true }),
                undefined as never,
                p.registries,
            ),
        )

        // Raw bytes, deliberately not `readManifest`, which repairs a bare entry in
        // memory and would mask the very thing being checked. This is the real guard.
        expect((await p.manifest()).optedOut).toEqual([`${NS}:add:base`])

        await withCwd(p.dir, () =>
            pullCommand(
                defaultArgs({ skipInstall: true, skills: false, format: false }),
                silentLoader(),
                p.registries,
            ),
        )

        // Over-determined: `migrateManifest` also canonicalizes bare `optedOut` on read
        // (pinned in `core/test/manifest-migration.test.ts`), so this leg cannot fail alone.
        const after = await p.manifest()
        expect(after.features.map((f) => f.id)).not.toContain(`${NS}:add:base`)
        expect(after.optedOut).toEqual([`${NS}:add:base`])
        // The file staying gone is the user-visible half: a manifest that omits the
        // record while the files are back on disk is still the handover leak.
        expect(await fileExists(p.dir, 'add-base.txt')).toBe(false)
    })
})

describe('battlestack add: still rejects what it should', () => {
    let p: Project
    beforeEach(async () => {
        p = await project()
    })

    // Asserted on the `UNKNOWN_FEATURE` code *and* the suggestion list, not the message:
    // deleting `addCommand`'s guard still yields that substring via `Registry.get`.
    async function expectUnknownFeature(id: string): Promise<void> {
        const err = await withCwd(p.dir, () => add(id)(p)).then(
            () => { throw new Error(`expected "${id}" to be rejected`) },
            (e: unknown) => e,
        )
        expect(err).toBeInstanceOf(CLIError)
        expect((err as CLIError).code).toBe(ErrorCode.UNKNOWN_FEATURE)
        expect((err as CLIError).message).toContain(`${NS}:add:opt`)
    }

    it('rejects an id no plugin registered', async () => {
        await expectUnknownFeature('add:nope')
    })

    it('rejects an id advertised by the framework but registered by nobody', async () => {
        // In `supportedFeatures`, no feature behind it. Must fail as unknown rather than
        // being waved through by the framework check.
        await expectUnknownFeature('add:unregistered')
    })

    it('rejects a feature the template does not offer', async () => {
        await expect(
            withCwd(p.dir, () => add('add:not-in-template')(p)),
        ).rejects.toThrow(/not optional for template/)
    })

    it('rejects a feature the framework does not advertise', async () => {
        await expect(
            withCwd(p.dir, () => add('add:not-advertised')(p)),
        ).rejects.toThrow(/not advertised by framework/)
    })

    it('rejects a feature scoped to a different framework', async () => {
        await expect(
            withCwd(p.dir, () => add('add:other-fw')(p)),
        ).rejects.toThrow(/not supported by framework/)
    })

    it('leaves the manifest untouched when validation rejects', async () => {
        const before = await p.manifest()
        await expect(withCwd(p.dir, () => add('add:not-advertised')(p))).rejects.toThrow()
        expect(await p.manifest()).toEqual(before)
    })

    it('throws outside a battlestack project', async () => {
        const outside = await mkdtemp(path.join(os.tmpdir(), 'battlestack-add-outside-'))
        dirs.push(outside)
        await expect(
            withCwd(outside, () => add('add:opt')(p)),
        ).rejects.toThrow(/Not inside a battlestack project/)
    })
})

// The invariant whose absence caused the bug: the CLI must never print an id it will then
// reject. Asserted on ids actually PRINTED, not re-derived, so it checks the round-trip.
describe('battlestack add --help offers only ids that add accepts', () => {
    it('every id the help lists is accepted', async () => {
        const p = await project()

        const lines = await withCwdCapture(p.dir, () =>
            addCommand(defaultArgs({ help: true }), undefined as never, p.registries),
        )
        // `ui.kv` prints `  <id><padding>  <label>`; the id is the first token.
        const offered = lines
            .map((line) => line.trim().split(/\s+/)[0] ?? '')
            .filter((token) => /^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)+$/.test(token))

        // Guard against a vacuous pass: if the help stopped listing anything, every
        // assertion below would still be green.
        expect(offered.length).toBeGreaterThan(0)
        expect(offered).toContain(`${NS}:add:opt`)

        for (const id of offered) {
            await withCwd(p.dir, () =>
                addCommand(
                    defaultArgs({ projectName: id, skipInstall: true, dryRun: true }),
                    undefined as never,
                    p.registries,
                ),
            )
        }
    })
})

// The same invariant where users actually reach it: `printAddHelp` is unreachable from
// the CLI, so the ids a real user sees come from error messages, not the help text.
describe('battlestack add error messages suggest only addable ids', () => {
    it('every id an error suggests is itself accepted', async () => {
        const p = await project()
        // Install one optional feature first, so "already installed" is a live exclusion
        // rather than a vacuously-satisfied one. Caught by mutation, not by inspection.
        await withCwd(p.dir, () => add('add:opt')(p))

        // `add:other-fw` is in `optionalFeatures` but scoped to another framework, so it
        // must NOT be suggested even though the raw array contains it.
        const err = await withCwd(p.dir, () => add('add:nope')(p)).then(
            () => { throw new Error('expected rejection') },
            (e: unknown) => e as CLIError,
        )
        const suggested = err.message
            .split(/[\s,]+/)
            .map((token) => token.replace(/[.".]+$/, ''))
            .filter((token) => /^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)+$/.test(token))
            .filter((token) => token !== 'add:nope')

        expect(suggested.length).toBeGreaterThan(0)
        expect(suggested).not.toContain(`${NS}:add:other-fw`)
        // Asserted directly, not via the loop below: re-adding an installed feature is a
        // graceful skip, so a loop checking "nothing was rejected" cannot see it.
        expect(suggested).not.toContain(`${NS}:add:opt`)
        for (const id of suggested) {
            await withCwd(p.dir, () =>
                addCommand(
                    defaultArgs({ projectName: id, skipInstall: true, dryRun: true }),
                    undefined as never,
                    p.registries,
                ),
            )
        }
    })
})

describe('battlestack add --dry-run', () => {
    it('reports what it would do and writes nothing', async () => {
        const p = await project()
        const before = await p.manifest()

        const lines = await withCwdCapture(p.dir, () =>
            addCommand(
                defaultArgs({ projectName: 'add:opt', skipInstall: true, dryRun: true }),
                undefined as never,
                p.registries,
            ),
        )

        expect(lines.join('\n')).toMatch(/dry-run/)
        expect(await p.manifest()).toEqual(before)
    })
})
