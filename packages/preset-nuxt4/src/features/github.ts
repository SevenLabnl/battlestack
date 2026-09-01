import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import type { Feature, PackageManager, RunContext, UpdateReport } from '@battlestack/core'
import { dropRecordedFile, exists, hashFile } from '@battlestack/core'
import { templatesDir, writeRecorded } from '@battlestack/core/utils/templates.js'
import { STAGE } from '@battlestack/core/constants/stages.js'
import { applyVars, renderPmVars } from '../utils/pm-template.js'

const FEATURE_ID = 'shared:github'

/** GitHub Actions gate: lint, typecheck, coverage, dependency audit. `<pm> audit` is advisory. */
export const githubFeature: Feature = {
    id: 'shared:github',
    // 3.0.0: SonarQube left this feature; `lint-test-sonarqube.yml` is now `lint-test.yml`.
    version: '3.0.0',
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
                    '`.github/workflows/lint-test.yml` runs lint, typecheck, test coverage and a dependency audit on pushes/PRs (plus a weekly scheduled run). Runs on `ubuntu-latest` by default, so it needs no self-hosted runner.',
                    '',
                    'Every step needs no configuration: they pass on a fresh clone or a fork. Nothing in this workflow talks to a service the repo cannot provide.',
                    '',
                    'Dependency scanning comes in two layers. `' + audit + '` runs on every push as an **advisory** step: it never fails the build, and its counts are written to the job summary so a non-blocking result is still visible without expanding a log. On pull requests, `dependency-review-action` is the **blocking** gate: it diffs the PR against its base and refuses anything the PR newly introduces at high severity or above.',
                    '',
                    'Know the limits of that blocking claim before you rely on it. `dependency-review-action` is free on public repositories but needs GitHub Advanced Security on private ones, and it only runs on `pull_request` events. **A private scaffold, or a push straight to a branch with no open PR, therefore has no blocking dependency gate at all**, only the advisory audit. If that matters to you, add `--audit-level=critical` to the audit step and remove its `continue-on-error`.',
                    '',
                    'A freshly scaffolded project\'s `' + audit + '` will report findings in transitive dependencies of the AI and framework stack. That is the npm-ecosystem baseline for an unpinned dependency tree, not a defect the scaffold introduced, and not something this project can unilaterally clear. The CI gate is shaped around that fact: `dependency-review-action` blocks vulnerabilities your changes *introduce*, while the audit step reports the standing baseline without failing the build.',
                    '',
                    'To run it on a self-hosted runner instead, set the repo/org variable `CI_RUNNER` to your runner\'s label; no template edit needed. If that runner\'s image is missing packages `ubuntu-latest` already has, set `CI_RUNNER_APT_PACKAGES` (space-separated) to have the workflow `apt-get install` them first; leave it unset to skip that step entirely.',
                    '',
                    'Secrets: any Docker build secrets declared by enabled features (see the Docker section for the exact env var names). This workflow itself needs none.',
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

    async update(ctx): Promise<UpdateReport> {
        const written = await emit(ctx)
        const { removed, kept } = await dropObsolete(ctx)
        const notes: string[] = []
        if (removed.length > 0) notes.push(`removed (SonarQube left this feature): ${removed.join(', ')}`)
        for (const rel of kept) {
            notes.push(`${rel}: edited since install, so left in place and no longer managed; delete it by hand if unused`)
        }
        return { written, skipped: [], notes }
    },
}

async function emit(ctx: RunContext): Promise<string[]> {
    // Single-segment `templatesDir(…, '.github')`. `workflows/` is joined separately.
    const workflowsDir = path.join(templatesDir(import.meta.url, '..', '..', 'templates', '.github'), 'workflows')
    const written: string[] = []

    // Rendered per package manager, not copied.
    const pm = String(ctx.state.packageManager ?? 'pnpm') as PackageManager
    const workflowRel = '.github/workflows/lint-test.yml'
    await writeRecorded(
        ctx,
        FEATURE_ID,
        workflowRel,
        applyVars(
            await readFile(path.join(workflowsDir, 'lint-test.yml'), 'utf8'),
            renderPmVars(pm),
        ),
    )
    written.push(workflowRel)

    return written
}

/** Paths this feature emitted before 3.0.0 and no longer owns. */
const OBSOLETE_PATHS = ['.github/workflows/lint-test-sonarqube.yml', 'sonar-project.properties']

/**
 * Drops the pre-3.0.0 SonarQube files. An untouched file is deleted; an edited
 * one is left on disk and merely unrecorded, so a project that customised it
 * keeps it and owns it.
 */
async function dropObsolete(ctx: RunContext): Promise<{ removed: string[], kept: string[] }> {
    const recorded = (ctx.state[`files:${FEATURE_ID}`] as Record<string, string> | undefined) ?? {}
    const removed: string[] = []
    const kept: string[] = []
    for (const rel of OBSOLETE_PATHS) {
        const abs = path.join(ctx.projectDir, rel)
        if (!(await exists(abs))) {
            dropRecordedFile(ctx, FEATURE_ID, rel)
            continue
        }
        if (recorded[rel] && recorded[rel] === (await hashFile(abs))) {
            await rm(abs, { force: true })
            removed.push(rel)
        } else {
            kept.push(rel)
        }
        dropRecordedFile(ctx, FEATURE_ID, rel)
    }
    return { removed, kept }
}
