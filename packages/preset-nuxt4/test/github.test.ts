import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

import { githubFeature } from '../src/features/github.js'
import { mockRunContext } from './test-utils.js'
import { hashFile } from '@battlestack/core'
import type { PackageManager } from '@battlestack/core'

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-github-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

function ctx() {
    return mockRunContext({
        projectDir,
        enabledFeatures: new Set(['shared:github']),
        state: { packageManager: 'pnpm' },
    })
}

async function exists(rel: string): Promise<boolean> {
    try {
        await access(path.join(projectDir, rel))
        return true
    } catch {
        return false
    }
}

describe('githubFeature', () => {
    it('emits the quality-gate workflow', async () => {
        await githubFeature.execute(ctx())

        const workflow = await readFile(
            path.join(projectDir, '.github/workflows/lint-test.yml'),
            'utf8',
        )
        expect(workflow.length).toBeGreaterThan(0)
        // Overridable per-org, with no internal runner label hardcoded.
        expect(workflow).toContain("runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}")
        // A real internal token on purpose: this is a NEGATIVE assertion, so the literal
        // IS the test. Do not "clean it up"; leak-guard.sh allowlists this file for it.
        expect(workflow).not.toMatch(/sevenlab/i)
        expect(workflow).toContain('if: vars.CI_RUNNER_APT_PACKAGES')
    })

    // SonarQube moved out of the public preset. Without these, the emit could quietly
    // come back and every other assertion here would still pass.
    it('emits nothing SonarQube-related', async () => {
        await githubFeature.execute(ctx())

        const workflow = await readFile(
            path.join(projectDir, '.github/workflows/lint-test.yml'),
            'utf8',
        )
        expect(workflow).not.toMatch(/sonar/i)
        expect(await exists('sonar-project.properties')).toBe(false)
        expect(await exists('.github/workflows/lint-test-sonarqube.yml')).toBe(false)
    })

    /**
     * Every remaining step runs with no configuration, so a fork's first push is green
     * and no step is gated on a variable only one organisation ever sets.
     */
    it('leaves every quality step ungated, so a fork\'s first push runs them all', async () => {
        await githubFeature.execute(ctx())
        const workflow = await readFile(
            path.join(projectDir, '.github/workflows/lint-test.yml'),
            'utf8',
        )

        // The four run unconditionally; a config-free fork still runs all four.
        // Split on the step delimiter so a resized step cannot shift the assertion.
        const steps = workflow.split(/^ {6}- (?=name:|uses:)/m)
        for (const stepName of [
            'name: Lint',
            'name: Typecheck',
            'name: Test with coverage',
            'name: Audit dependencies (advisory)',
        ]) {
            // Match through the newline, or `name: Lint` also matches the file header
            // and the assertion below passes against a segment that never had an `if:`.
            const step = steps.find((s) => s.startsWith(`${stepName}\n`))
            expect(step, `step "${stepName}" not found`).toBeDefined()
            expect(step).not.toContain('if: vars.')
        }
    })

    it('has no knowledge of any deploy target: no deploy workflow, no deploy-target docs', async () => {
        await githubFeature.execute(ctx())

        // Only the generic quality gate ships; deploy pipelines are a plugin's job.
        expect(await exists('.github/workflows/production.yml')).toBe(false)
        expect(await exists('.github/workflows/production-sevenlab.yml')).toBe(false)
        expect(await exists('.github/workflows/development.yml')).toBe(false)
        expect(await exists('.github/workflows/staging.yml')).toBe(false)

        expect(githubFeature.prompt).toBeUndefined()
        expect(ctx().state.deployTarget).toBeUndefined()

        const docs = githubFeature.collectDocs!(ctx())
        const body = docs?.map((d) => d.body).join('\n') ?? ''
        // Real tokens again, deliberately: they name the internal deploy stack whose
        // absence from public docs is the whole point. Negative assertions need them.
        expect(body).not.toMatch(/sevenlab/i)
        expect(body).not.toMatch(/SCW_REGISTRY/i)
        expect(body).not.toMatch(/ARGOCD/i)
        expect(body).not.toMatch(/kustomiz/i)
    })

    describe('dropping the pre-3.0.0 SonarQube files', () => {
        const OLD_WORKFLOW = '.github/workflows/lint-test-sonarqube.yml'
        const OLD_SONAR = 'sonar-project.properties'

        /** A project as 2.x left it: both files on disk and recorded against their hashes. */
        async function legacyProject(opts: { edited?: boolean } = {}) {
            const shipped = 'name: Lint, Test & SonarQube\n'
            await mkdir(path.join(projectDir, '.github/workflows'), { recursive: true })
            await writeFile(path.join(projectDir, OLD_WORKFLOW), shipped)
            await writeFile(path.join(projectDir, OLD_SONAR), 'sonar.projectKey=x\n')
            // Hashes recorded against the SHIPPED bytes, then the edit lands on top, so
            // an edited file genuinely differs from its record the way drift does.
            const recorded = {
                [OLD_WORKFLOW]: await hashFile(path.join(projectDir, OLD_WORKFLOW)),
                [OLD_SONAR]: await hashFile(path.join(projectDir, OLD_SONAR)),
            }
            if (opts.edited) {
                await writeFile(path.join(projectDir, OLD_WORKFLOW), `${shipped}# mine\n`)
            }
            return mockRunContext({
                projectDir,
                enabledFeatures: new Set(['shared:github']),
                state: { 'packageManager': 'pnpm', 'files:shared:github': recorded },
            })
        }

        it('deletes both when untouched, and unrecords them', async () => {
            const c = await legacyProject()
            const report = await githubFeature.update!(c, null)

            expect(await exists(OLD_WORKFLOW)).toBe(false)
            expect(await exists(OLD_SONAR)).toBe(false)
            expect(report.notes.join(' ')).toContain('removed')
            const recorded = c.state['files:shared:github'] as Record<string, string>
            expect(Object.keys(recorded)).not.toContain(OLD_WORKFLOW)
            expect(Object.keys(recorded)).not.toContain(OLD_SONAR)
        })

        // The disabled run: an edited file must survive. Without this the cleanup could
        // delete unconditionally and the test above would still pass.
        it('keeps an edited file, and says so', async () => {
            const c = await legacyProject({ edited: true })
            const report = await githubFeature.update!(c, null)

            expect(await exists(OLD_WORKFLOW)).toBe(true)
            expect(await readFile(path.join(projectDir, OLD_WORKFLOW), 'utf8')).toContain('# mine')
            expect(report.notes.join(' ')).toContain(OLD_WORKFLOW)
            expect(report.notes.join(' ')).toContain('no longer managed')
            // The untouched one still goes.
            expect(await exists(OLD_SONAR)).toBe(false)
        })

        it('is a no-op on a project that never had them', async () => {
            const report = await githubFeature.update!(ctx(), null)
            expect(report.notes).toEqual([])
        })
    })

    it('update() reports the workflow as written', async () => {
        const report = await githubFeature.update!(ctx(), null)
        expect(report.written).toEqual(['.github/workflows/lint-test.yml'])
        expect(await exists('.github/workflows/lint-test.yml')).toBe(true)
    })

    it('collectDocs documents the quality gate under a single GitHub Actions heading', () => {
        const docs = githubFeature.collectDocs!(ctx())
        expect(docs).toHaveLength(1)
        expect(docs?.[0].heading).toBe('GitHub Actions')
        expect(docs?.[0].body).toContain('lint-test.yml')
        expect(docs?.[0].body).toContain('CI_RUNNER')
        expect(docs?.[0].body).toContain('CI_RUNNER_APT_PACKAGES')
        expect(docs?.[0].targets).toEqual(['readme', 'agents'])
    })

    /**
     * The OWASP step this replaced was gated on an NVD mirror reachable from one private
     * network, so every fork skipped it: scanning was advertised and never performed.
     */
    describe('dependency scanning is the universal signal, not the private one', () => {
        it('emits no OWASP Dependency-Check step and names no NVD mirror', async () => {
            await githubFeature.execute(ctx())
            const workflow = await readFile(
                path.join(projectDir, '.github/workflows/lint-test.yml'),
                'utf8',
            )

            expect(workflow).not.toMatch(/owasp/i)
            expect(workflow).not.toMatch(/dependency-check/i)
            expect(workflow).not.toContain('DEPENDENCYCHECK_DB_CONNECTION')
            expect(workflow).not.toContain('DEPENDENCYCHECK_DB_USERNAME')
            expect(workflow).not.toContain('DEPENDENCYCHECK_DB_PASSWORD')
            // The mirror is internal infrastructure; naming it leaks its shape even
            // without a hostname.
            expect(workflow).not.toMatch(/nvd/i)
        })

        /**
         * Advisory by ruling: an unpinned tree carries a standing baseline of transitive
         * advisories, and blocking on one nobody can clear reddens every fork's first push.
         */
        it('runs the audit as advisory; it never fails the build', async () => {
            await githubFeature.execute(ctx())
            const workflow = await readFile(
                path.join(projectDir, '.github/workflows/lint-test.yml'),
                'utf8',
            )

            const steps = workflow.split(/^ {6}- (?=name:|uses:)/m)
            const audit = steps.find((s) => s.startsWith('name: Audit dependencies (advisory)'))
            expect(audit, 'advisory audit step not found').toBeDefined()
            expect(audit).toContain('continue-on-error: true')
            expect(audit).toContain('pnpm audit')

            // No `--audit-level` on the invocation: under `continue-on-error` a threshold
            // is inert and implies a gate that isn't there. Prose about it is fine.
            expect(workflow).not.toMatch(/(pnpm|npm|bun|yarn) audit[^\n]*--audit-level/)
        })

        /**
         * A `continue-on-error` step whose result lives only in a collapsed log is a
         * finding nobody sees: the same false-health failure this change exists to remove.
         */
        it('writes audit counts to the job summary so an advisory result is not buried', async () => {
            await githubFeature.execute(ctx())
            const workflow = await readFile(
                path.join(projectDir, '.github/workflows/lint-test.yml'),
                'utf8',
            )

            const steps = workflow.split(/^ {6}- (?=name:|uses:)/m)
            const audit = steps.find((s) => s.startsWith('name: Audit dependencies (advisory)'))
            expect(audit).toContain('GITHUB_STEP_SUMMARY')
            expect(audit).toContain('--json')
            // The summary must state it is non-blocking; a bare count reads as a failure
            // the build ignored.
            expect(audit).toContain('does not fail the build')
        })

        it('blocks newly introduced vulnerable deps on PRs via dependency-review', async () => {
            await githubFeature.execute(ctx())
            const workflow = await readFile(
                path.join(projectDir, '.github/workflows/lint-test.yml'),
                'utf8',
            )

            expect(workflow).toContain('actions/dependency-review-action@v4')
            expect(workflow).toContain('fail-on-severity: high')

            const steps = workflow.split(/^ {6}- (?=name:|uses:)/m)
            const review = steps.find((s) => s.startsWith('name: Dependency review'))
            expect(review, 'dependency review step not found').toBeDefined()
            // The action can only diff a PR's base against its head and errors on a push
            // event, so without this condition every push to main goes red.
            expect(review).toContain("if: github.event_name == 'pull_request'")
            expect(review).not.toContain('continue-on-error')
        })

        /**
         * Nothing type-checks the inline `node -e` program in the YAML, so every
         * "contains GITHUB_STEP_SUMMARY" test stays green while it is broken.
         */
        describe('the emitted summary generator actually runs', () => {
            /** Pull the `node -e '…'` program verbatim out of the emitted workflow. */
            async function extractSummaryProgram(): Promise<string> {
                await githubFeature.execute(ctx())
                const workflow = await readFile(
                    path.join(projectDir, '.github/workflows/lint-test.yml'),
                    'utf8',
                )
                const m = workflow.match(/node -e '\n([\s\S]*?)\n {10}'\n/)
                expect(m, 'could not find the inline node program in the workflow').not.toBeNull()
                return m![1]
                    .split('\n')
                    .map((l) => (l.startsWith(' '.repeat(12)) ? l.slice(12) : l))
                    .join('\n')
            }

            async function runSummary(auditJson: string | null): Promise<string> {
                const program = await extractSummaryProgram()
                const dir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-summary-'))
                const summaryPath = path.join(dir, 'summary.md')
                await writeFile(path.join(dir, 'audit.json'), auditJson ?? 'this is not json')
                await writeFile(summaryPath, '')
                // `node -e` exactly as the workflow invokes it: writing the program to a
                // file changes module semantics (`.mjs` has no `require`).
                await execFileAsync('node', ['-e', program], {
                    env: { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: summaryPath },
                })
                const out = await readFile(summaryPath, 'utf8')
                await rm(dir, { recursive: true, force: true })
                return out
            }

            const auditJson = (v: Record<string, number>) =>
                JSON.stringify({ advisories: {}, metadata: { vulnerabilities: v } })

            it('renders the real severity counts (pnpm shape)', async () => {
                // The measured pristine-scaffold shape.
                const out = await runSummary(
                    auditJson({ info: 0, low: 4, moderate: 9, high: 3, critical: 0 }),
                )
                expect(out).toContain('**3** high')
                expect(out).toContain('**9** moderate')
                expect(out).toContain('**4** low')
                // Zero buckets are omitted; "0 critical" would read as a finding.
                expect(out).not.toContain('critical')
                expect(out).toContain('does not fail the build')
            })

            /**
             * `npm audit --json` carries the same `metadata.vulnerabilities` block but
             * adds a `total` key. Summing the map blindly would double every count.
             */
            it('renders npm shape without double-counting its `total` key', async () => {
                const out = await runSummary(
                    JSON.stringify({
                        metadata: {
                            vulnerabilities: {
                                info: 0, low: 0, moderate: 0, high: 0, critical: 2, total: 2,
                            },
                        },
                    }),
                )
                expect(out).toContain('**2** critical')
                expect(out).not.toContain('total')
            })

            /**
             * The one that bit: `bun audit --json` emits no `metadata` block, just a flat
             * package map, so the pnpm/npm path read every bun summary as "Could not parse".
             */
            it('renders bun shape, which has no metadata block', async () => {
                const out = await runSummary(
                    JSON.stringify({
                        lodash: [
                            { id: 1, severity: 'moderate', title: 'Prototype Pollution' },
                            { id: 2, severity: 'high', title: 'Code Injection' },
                        ],
                        minimist: [{ id: 3, severity: 'critical', title: 'Prototype Pollution' }],
                    }),
                )
                expect(out).toContain('**1** critical')
                expect(out).toContain('**1** high')
                expect(out).toContain('**1** moderate')
                expect(out).not.toContain('Could not parse')
            })

            it('says so plainly when there is nothing to report', async () => {
                const out = await runSummary(
                    auditJson({ info: 0, low: 0, moderate: 0, high: 0, critical: 0 }),
                )
                expect(out).toContain('No known advisories.')
            })

            it('degrades to a visible message rather than crashing on an unparseable report', async () => {
                // The audit call is `|| true`, so the file may be garbage; silence is the bug.
                const out = await runSummary('this is not json')
                expect(out).toContain('Could not parse the audit report')
            })

            /**
             * `bun audit --json` writes zero bytes when it has nothing to audit, and so
             * does a crashed audit. A false all-clear is worse than an ugly summary.
             */
            it('never turns empty output into a false all-clear', async () => {
                const out = await runSummary('')
                expect(out).not.toContain('No known advisories')
                expect(out).toContain('produced no output')
                expect(out).toContain('Check the step log')
            })
        })

        /**
         * Emitted prose must name the package manager the project actually uses:
         * "`pnpm audit` runs on every push" is false in an npm or bun scaffold.
         */
        it.each<[PackageManager, string]>([
            ['npm', 'npm audit'],
            ['bun', 'bun audit'],
            ['pnpm', 'pnpm audit'],
        ])('names %s\'s own audit command in the emitted docs', (pm, expected) => {
            const docs = githubFeature.collectDocs!(
                mockRunContext({
                    projectDir,
                    enabledFeatures: new Set(['shared:github']),
                    state: { packageManager: pm },
                }),
            )
            const body = docs?.[0].body ?? ''
            expect(body).toContain(`\`${expected}\``)
            for (const other of ['pnpm audit', 'npm audit', 'bun audit']) {
                if (other !== expected) expect(body).not.toContain(`\`${other}\``)
            }
        })

        /**
         * `--audit-level` is the blocking opt-in the docs tell readers to add. All three
         * real CLIs spell it identically, so it can stay literal in rendered prose.
         */
        it('gives blocking-opt-in advice that is valid for every package manager', () => {
            for (const pm of ['pnpm', 'npm', 'bun'] as PackageManager[]) {
                const body =
                    githubFeature.collectDocs!(
                        mockRunContext({
                            projectDir,
                            enabledFeatures: new Set(['shared:github']),
                            state: { packageManager: pm },
                        }),
                    )?.[0].body ?? ''
                expect(body).toContain('--audit-level=critical')
            }
        })

        it('documents which layer blocks and which only reports', () => {
            const docs = githubFeature.collectDocs!(ctx())
            const body = docs?.[0].body ?? ''
            expect(body).toContain('dependency-review-action')
            expect(body).toContain('advisory')
            // The docs must not keep promising a scan that no longer ships.
            expect(body).not.toMatch(/owasp/i)
            expect(body).not.toContain('DEPENDENCYCHECK_DB_CONNECTION')
            expect(body).not.toMatch(/nvd/i)
        })

        /**
         * "Blocking" is true only on a public repo, on a pull request. Unqualified, the
         * claim describes a gate as covering more than it does.
         */
        it('qualifies the blocking claim instead of letting it overreach', () => {
            const body = githubFeature.collectDocs!(ctx())?.[0].body ?? ''
            expect(body).toMatch(/Advanced Security/i)
            expect(body).toMatch(/pull_request/)
            // The case a reader most needs spelled out.
            expect(body).toMatch(/no blocking dependency gate/i)
        })

        /**
         * Counts drift weekly in an unpinned tree, so a number baked into emitted docs
         * becomes a false claim within a month. Exact figures live in the task record.
         */
        it('describes the audit baseline as a class, never as a hardcoded count', () => {
            const body = githubFeature.collectDocs!(ctx())?.[0].body ?? ''
            expect(body).toMatch(/baseline/i)
            expect(body).toMatch(/not a defect the scaffold introduced/i)
            // No severity tallies: catches an edit pasting today's numbers in.
            expect(body).not.toMatch(/\b\d+\s+(critical|high|moderate|low)\b/i)
        })
    })
})
