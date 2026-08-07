import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Feature, PackageManager, RunContext } from '@battlestack/core'
import { templatesDir, writeRecorded } from '@battlestack/core/utils/templates.js'
import { STAGE } from '@battlestack/core/constants/stages.js'
import { applyVars, renderPmVars } from '../utils/pm-template.js'

const FEATURE_ID = 'shared:github'

/** GitHub Actions gate: lint, typecheck, coverage, audit, SonarQube. `<pm> audit` is advisory. */
export const githubFeature: Feature = {
    id: 'shared:github',
    // 2.2.0: renders per package manager instead of copied pnpm-hardcoded.
    version: '2.2.0',
    label: 'GitHub Actions workflows',
    stage: STAGE.GITIGNORE,
    failureIsNonFatal: true,

    // The workflow runs the project's own package manager.
    collectDocs(ctx) {
        const audit = `${String(ctx.state.packageManager ?? 'pnpm')} audit`
        return [
            {
                heading: 'GitHub Actions',
                body: [
                    '`.github/workflows/lint-test-sonarqube.yml` runs lint, typecheck, test coverage, a dependency audit, and a SonarQube scan on pushes/PRs (plus a weekly scheduled run). Runs on `ubuntu-latest` by default, so it needs no self-hosted runner.',
                    '',
                    'Lint, typecheck, test and the dependency audit need no configuration: they pass on a fresh clone or a fork. Only the SonarQube scan talks to a service this repo can\'t provide, so it is skipped unless `vars.SONAR_HOST_URL` is set. Set the variable and the step turns itself on (nothing to uncomment).',
                    '',
                    'Dependency scanning comes in two layers. `' + audit + '` runs on every push as an **advisory** step: it never fails the build, and its counts are written to the job summary so a non-blocking result is still visible without expanding a log. On pull requests, `dependency-review-action` is the **blocking** gate: it diffs the PR against its base and refuses anything the PR newly introduces at high severity or above.',
                    '',
                    'Know the limits of that blocking claim before you rely on it. `dependency-review-action` is free on public repositories but needs GitHub Advanced Security on private ones, and it only runs on `pull_request` events. **A private scaffold, or a push straight to a branch with no open PR, therefore has no blocking dependency gate at all**, only the advisory audit. If that matters to you, add `--audit-level=critical` to the audit step and remove its `continue-on-error`.',
                    '',
                    'A freshly scaffolded project\'s `' + audit + '` will report findings in transitive dependencies of the AI and framework stack. That is the npm-ecosystem baseline for an unpinned dependency tree, not a defect the scaffold introduced, and not something this project can unilaterally clear. The CI gate is shaped around that fact: `dependency-review-action` blocks vulnerabilities your changes *introduce*, while the audit step reports the standing baseline without failing the build.',
                    '',
                    'To run it on a self-hosted runner instead, set the repo/org variable `CI_RUNNER` to your runner\'s label; no template edit needed. If that runner\'s image is missing packages `ubuntu-latest` already has, set `CI_RUNNER_APT_PACKAGES` (space-separated) to have the workflow `apt-get install` them first; leave it unset to skip that step entirely.',
                    '',
                    'Variables: `SONAR_HOST_URL`; secrets: `SONAR_TOKEN`, plus any Docker build secrets declared by enabled features (see the Docker section for the exact env var names). The SonarQube static config lives in `sonar-project.properties` (sources, coverage exclusions, lcov report path).',
                    '',
                    'This feature ships no deploy workflow. A plugin that contributes a deploy target adds its own `.github/workflows/*.yml` pipeline for it and documents its own deploy secrets.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emit(ctx)
    },

    async update(ctx) {
        const written = await emit(ctx)
        return { written, skipped: [], notes: [] }
    },
}

async function emit(ctx: RunContext): Promise<string[]> {
    // Single-segment `templatesDir(…, '.github')`. `workflows/` is joined separately.
    const workflowsDir = path.join(templatesDir(import.meta.url, '..', '..', 'templates', '.github'), 'workflows')
    const written: string[] = []

    // Rendered per package manager, not copied.
    const pm = String(ctx.state.packageManager ?? 'pnpm') as PackageManager
    const workflowRel = '.github/workflows/lint-test-sonarqube.yml'
    await writeRecorded(
        ctx,
        FEATURE_ID,
        workflowRel,
        applyVars(
            await readFile(path.join(workflowsDir, 'lint-test-sonarqube.yml'), 'utf8'),
            renderPmVars(pm),
        ),
    )
    written.push(workflowRel)

    // Static SonarQube config. host, token and projectKey stay as -D flags.
    const sonarSrc = path.join(templatesDir(import.meta.url, '..', '..', 'templates', 'sonar'), 'sonar-project.properties')
    await writeRecorded(ctx, FEATURE_ID, 'sonar-project.properties', await readFile(sonarSrc, 'utf8'))
    written.push('sonar-project.properties')

    return written
}
