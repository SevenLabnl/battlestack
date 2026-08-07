import path from 'node:path'
import { readJson, writeJson, STAGE, type Feature } from '@battlestack/core'

export const namingFeature: Feature = {
    id: 'nuxt4:naming',
    version: '1.0.0',
    label: 'Set package.json name',
    frameworks: ['nuxt4'],
    stage: STAGE.NAMING,
    upgradable: false,

    async execute(ctx) {
        const pkgPath = path.join(ctx.projectDir, 'package.json')
        const pkg = await readJson<Record<string, unknown>>(pkgPath)
        pkg.name = ctx.projectName
        await writeJson(pkgPath, pkg)
    },
}
