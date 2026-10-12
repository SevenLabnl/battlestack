import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BattlestackRegistries, STAGE, type Feature } from '@battlestack/core'
import { installFeature } from '../src/features/install.js'
import { mockRunContext } from './test-utils.js'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-install-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

async function install(existing: Record<string, unknown>, devSpecs: string[]): Promise<Record<string, Record<string, string>>> {
    await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'demo', ...existing }), 'utf8')
    const registries = new BattlestackRegistries()
    const feature: Feature = {
        id: 'test:deps',
        version: '1.0.0',
        label: 'deps',
        stage: STAGE.BASE_CONFIG,
        async execute() {},
        collectDeps: () => ({ dev: devSpecs }),
    }
    registries.features.register(feature, { plugin: '@test/install', namespace: 'test' })
    await installFeature.execute(mockRunContext({
        projectDir,
        registries,
        enabledFeatures: new Set(['test:deps']),
        state: { packageManager: 'pnpm', skipInstall: true },
    }))
    return JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
}

describe('shared:install dependency buckets', () => {
    it('a feature pin beats a pin that moves in from the other bucket', async () => {
        const pkg = await install({ dependencies: { typescript: '^7.0.2' } }, ['typescript@^6'])
        expect(pkg.dependencies.typescript).toBeUndefined()
        expect(pkg.devDependencies.typescript).toBe('^6')
    })

    it('an existing pin moves with the dep when the feature declares no version', async () => {
        const pkg = await install({ dependencies: { typescript: '^7.0.2' } }, ['typescript'])
        expect(pkg.dependencies.typescript).toBeUndefined()
        expect(pkg.devDependencies.typescript).toBe('^7.0.2')
    })
})
