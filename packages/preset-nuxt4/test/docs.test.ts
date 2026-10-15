import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    applyPlugin,
    BattlestackRegistries,
    finalizeRegistries,
    type InstalledFeatureRecord,
    type RunContext,
} from '@battlestack/core'

import presetNuxt4 from '../src/index.js'
import { docsFeature } from '../src/features/docs.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-docs-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

/** The fullstack template with every optional feature on: the largest AGENTS.md the preset produces. */
function ctx(drop: string[] = []): RunContext {
    const registries = new BattlestackRegistries()
    const { extensions } = applyPlugin(presetNuxt4, 'bundled', registries)
    finalizeRegistries(registries, extensions)
    const template = registries.templates.get('nuxt4-fullstack')
    const enabled = [...template.requiredFeatures, ...(template.optionalFeatures ?? [])]
    return mockRunContext({
        projectDir,
        template,
        framework: registries.frameworks.get('nuxt4'),
        registries,
        // Template lists hold fqids such as `nuxt4:nuxt4:pwa`.
        enabledFeatures: new Set(enabled.filter((id) => !drop.some((d) => id.endsWith(d)))),
        state: { packageManager: 'pnpm' },
    })
}

const read = (rel: string): Promise<string> => readFile(path.join(projectDir, rel), 'utf8')

function recordFrom(c: RunContext, ownedByUser?: string[]): InstalledFeatureRecord {
    const files = c.state[`files:${docsFeature.id}`] as Record<string, string>
    return { id: docsFeature.id, version: '1.0.0', files: { ...files }, ownedByUser }
}

describe('docsFeature: AGENTS.md stays an index', () => {
    it('keeps AGENTS.md small and moves feature sections to docs/battlestack/', async () => {
        await docsFeature.execute!(ctx())
        const agents = await read('AGENTS.md')
        expect(Buffer.byteLength(agents)).toBeLessThan(8 * 1024)
        expect(agents).toContain('## battlestack owns most files')
        expect(agents).not.toContain('## Database')

        const database = await read('docs/battlestack/database.md')
        expect(database).toContain('## Database')
        expect(agents).toContain('- `docs/battlestack/database.md`: Database')

        const refs = await readdir(path.join(projectDir, 'docs/battlestack'))
        for (const file of refs) expect(agents).toContain(`\`docs/battlestack/${file}\``)
        expect(refs).toContain('server-state.md')
    })

    it('on pull, removes a dropped feature\'s pristine doc and backs up an edited AGENTS.md', async () => {
        const scaffold = ctx()
        await docsFeature.execute!(scaffold)
        const prev = recordFrom(scaffold)
        await writeFile(path.join(projectDir, 'AGENTS.md'), '# hand-edited\n', 'utf8')

        const pull = ctx(['nuxt4:pwa'])
        pull.state[`files:${docsFeature.id}`] = { ...prev.files }
        const report = await docsFeature.update!(pull, prev)

        expect(existsSync(path.join(projectDir, 'docs/battlestack/pwa.md'))).toBe(false)
        expect(pull.state[`files:${docsFeature.id}`]).not.toHaveProperty('docs/battlestack/pwa.md')
        expect(await read('.battlestack/pull/AGENTS.md.bak')).toBe('# hand-edited\n')
        expect(await read('AGENTS.md')).toContain('## Feature reference')
        expect(report.notes.join('\n')).toContain('AGENTS.md: had local edits')
    })

    it('leaves an owned AGENTS.md alone on pull', async () => {
        const scaffold = ctx()
        await docsFeature.execute!(scaffold)
        await writeFile(path.join(projectDir, 'AGENTS.md'), '# mine\n', 'utf8')

        const report = await docsFeature.update!(ctx(), recordFrom(scaffold, ['AGENTS.md']))

        expect(await read('AGENTS.md')).toBe('# mine\n')
        expect(report.skipped).toContain('AGENTS.md')
    })
})
