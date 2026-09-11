import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BattlestackRegistries, type Feature } from '@battlestack/core'
import { dockerFeature } from '../src/features/docker.js'
import { mockRunContext } from './test-utils.js'

/**
 * `shared:docker`'s install-secret block used to hardcode one feature in three places.
 * These exercise the generic `collectBuildSecrets()` aggregation that replaced it.
 */

let projectDir: string

function registryWith(features: Feature[]): BattlestackRegistries {
    const registries = new BattlestackRegistries()
    for (const f of features) {
        registries.features.register(f, { plugin: 'test', namespace: 'test' })
    }
    return registries
}

const secretFeature: Feature = {
    id: 'shared:secret-thing',
    label: 'secret thing',
    stage: 'ICONS',
    version: '1.0.0',
    collectBuildSecrets: () => [{ id: 'MY_TOKEN', required: false }],
    async execute() {},
}

const secretFeatureCustomEnv: Feature = {
    id: 'shared:secret-thing-2',
    label: 'secret thing 2',
    stage: 'ICONS',
    version: '1.0.0',
    collectBuildSecrets: () => [{ id: 'OTHER_SECRET', env: 'OTHER_ENV_NAME', required: true }],
    async execute() {},
}

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-docker-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

describe('shared:docker (collectBuildSecrets)', () => {
    it('emits a bare install RUN when no enabled feature declares a build secret', async () => {
        const ctx = mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:docker']),
            state: { packageManager: 'pnpm' },
            registries: registryWith([dockerFeature]),
        })
        await dockerFeature.execute(ctx)
        const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8')
        expect(dockerfile).toContain('RUN pnpm install --frozen-lockfile')
        expect(dockerfile).not.toContain('--mount=type=secret')
    })

    it('mounts + exports a declared build secret from an arbitrary feature (not FontAwesome-specific)', async () => {
        const ctx = mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:docker', 'shared:secret-thing']),
            state: { packageManager: 'pnpm' },
            registries: registryWith([dockerFeature, secretFeature]),
        })
        await dockerFeature.execute(ctx)
        const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8')
        expect(dockerfile).toContain('--mount=type=secret,id=MY_TOKEN,required=false')
        expect(dockerfile).toContain(
            'if [ -f /run/secrets/MY_TOKEN ]; then export MY_TOKEN=$(cat /run/secrets/MY_TOKEN); fi',
        )
        expect(dockerfile).toContain('pnpm install --frozen-lockfile')
        expect(dockerfile).not.toContain('FONTAWESOME')
    })

    it('honors a custom env name and required=true, and aggregates across multiple features', async () => {
        const ctx = mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:docker', 'shared:secret-thing', 'shared:secret-thing-2']),
            state: { packageManager: 'npm' },
            registries: registryWith([dockerFeature, secretFeature, secretFeatureCustomEnv]),
        })
        await dockerFeature.execute(ctx)
        const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8')
        expect(dockerfile).toContain('--mount=type=secret,id=MY_TOKEN,required=false')
        expect(dockerfile).toContain('--mount=type=secret,id=OTHER_SECRET,required=true')
        expect(dockerfile).toContain(
            'if [ -f /run/secrets/OTHER_SECRET ]; then export OTHER_ENV_NAME=$(cat /run/secrets/OTHER_SECRET); fi',
        )
        expect(dockerfile).toContain('npm ci')
    })

    it('collectDocs mentions the forwarded env var name(s) only when a secret is declared', () => {
        const withSecret = mockRunContext({
            enabledFeatures: new Set(['shared:docker', 'shared:secret-thing-2']),
            registries: registryWith([dockerFeature, secretFeatureCustomEnv]),
        })
        const docsWith = dockerFeature.collectDocs!(withSecret)
        expect(docsWith?.[0]?.body).toContain('OTHER_ENV_NAME')
        expect(docsWith?.[0]?.body).not.toContain('FONTAWESOME')

        const withoutSecret = mockRunContext({
            enabledFeatures: new Set(['shared:docker']),
            registries: registryWith([dockerFeature]),
        })
        const docsWithout = dockerFeature.collectDocs!(withoutSecret)
        expect(docsWithout?.[0]?.body).not.toContain('build secret')
    })
})

/**
 * `@mastra/core` reaches some packages only through an npm alias and changes which alias
 * between minor versions, so the emitted Dockerfile must derive the aliases to copy from
 * package.json rather than name them, and must fail the build on one it did not provide.
 */
describe('shared:docker (npm-aliased deps)', () => {
    async function emitDockerfile(): Promise<string> {
        const ctx = mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:docker']),
            state: { packageManager: 'pnpm' },
            registries: registryWith([dockerFeature]),
        })
        await dockerFeature.execute(ctx)
        return readFile(path.join(projectDir, 'Dockerfile'), 'utf8')
    }

    it('copies aliases read from package.json, naming none of them', async () => {
        const dockerfile = await emitDockerfile()
        expect(dockerfile).toContain('spec.startsWith("npm:")')
        expect(dockerfile).toContain('.output/server/node_modules')
        expect(dockerfile).toContain('dereference:true')
        expect(dockerfile).not.toContain('provider-utils-v5')
        expect(dockerfile).not.toContain('zod-from-json-schema-v3')
    })

    it('fails the build on an alias the output imports but no copy provided', async () => {
        const dockerfile = await emitDockerfile()
        expect(dockerfile).toContain('under an alias name that is not in the output')
        expect(dockerfile).toContain('process.exit(1)')
    })
})
