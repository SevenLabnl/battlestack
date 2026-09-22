import { STAGE, type Feature } from '@battlestack/core'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'

/**
 * Build identity in the app itself: `useBuildInfo()`, the `<AppBuildInfo>` footer line,
 * and the four `runtimeConfig.public` keys the production image fills from its build args.
 *
 * Required rather than optional, and not folded into `nuxt4:health`: a deployed app that
 * cannot tell you which commit it is running is the failure this exists to prevent, and
 * that is as true for a project with no health endpoint as for one with it.
 */
export const buildInfoFeature: Feature = {
    id: 'nuxt4:build-info',
    version: '1.0.0',
    label: 'Build info (version + commit in the footer)',
    description: 'Version and commit sha in the app footer, from the image\'s build args.',
    frameworks: ['nuxt4'],
    stage: STAGE.BASE_CONFIG,
    after: ['nuxt4:nuxt-ui'],

    collectDocs() {
        return [
            {
                heading: 'Version and commit',
                body: [
                    'Every deployed instance says what it is: `useBuildInfo()` returns the version, the commit and the build time, `<AppBuildInfo>` renders them in the footer, and `/api/health` reports the same values as JSON.',
                    '',
                    'The values live in `runtimeConfig.public` — `appVersion`, `appCommit`, `appBuiltAt`, `appRepoUrl` — and the production image sets them from its build args:',
                    '',
                    '| Build arg | Env var | Shown as |',
                    '| --- | --- | --- |',
                    '| `APP_VERSION` | `NUXT_PUBLIC_APP_VERSION` | `Version 1.4.2` |',
                    '| `GIT_SHA` | `NUXT_PUBLIC_APP_COMMIT` | the short sha, linked to the commit |',
                    '| `BUILD_TIME` | `NUXT_PUBLIC_APP_BUILT_AT` | tooltip on the sha |',
                    '| `APP_REPO_URL` | `NUXT_PUBLIC_APP_REPO_URL` | what the sha links to |',
                    '',
                    'They are declared in the runtime stage, so a new commit rebuilds the last, tiny layer and reuses the cached dependency install and Nuxt build.',
                    '',
                    '**Cutting a version.** Actions → **Release** → Run workflow, pick `patch`, `minor` or `major`. It reads the highest existing `v*` tag, bumps it and pushes the new annotated tag plus a GitHub release. The number is yours to choose: nothing bumps it on its own.',
                    '',
                    'It writes no commit and opens no pull request. The version is a property of the tagged commit, and the deploy pipeline derives it with `git describe --tags --match \'v*\'` — so there is no release commit to merge, and no `package.json` field that can drift out of step with the tag.',
                    '',
                    'A commit past the last tag builds as `1.4.2-5-gabc1234`: five commits after `v1.4.2`. That is deliberate. It reads as "not a release" at a glance, which is what it is.',
                    '',
                    '**Locally** nothing is baked in, so the footer reads `Version dev` with no sha. An unknown commit shows as unknown rather than as a plausible-looking wrong one. To see a real one:',
                    '',
                    '```bash',
                    'APP_VERSION=1.4.2 GIT_SHA=$(git rev-parse HEAD) battlestack prod',
                    '```',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, this.id, import.meta.url, 'build-info')
        await registerRuntimeConfig(ctx.projectDir)
    },

    async update(ctx, prev) {
        const report = await emitTemplateUpdate(ctx, this.id, import.meta.url, 'build-info', prev)
        await registerRuntimeConfig(ctx.projectDir)
        return report
    },
}

/**
 * Nuxt only lets `NUXT_PUBLIC_*` override a key that already exists in `runtimeConfig`,
 * so every key the image sets has to be declared here even though its value is empty.
 *
 * Deliberately not contributed to `.env`: these describe a built image, and a development
 * `.env` that set them would have the dev server report a commit it was never built from.
 */
async function registerRuntimeConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c
            // Shared with `nuxt4:health`, which reports the same version on `/api/health`.
            // `setRuntimePublicDefault` never clobbers, so whichever runs second is a no-op.
            .setRuntimePublicDefault('appVersion', 'dev')
            .setRuntimePublicDefault('appCommit', '')
            .setRuntimePublicDefault('appBuiltAt', '')
            .setRuntimePublicDefault('appRepoUrl', ''),
    )
}
