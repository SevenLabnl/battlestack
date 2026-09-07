import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))
const src = (pkg: string) => path.join(root, 'packages', pkg, 'src')

// One runner across the whole workspace: every package's tests live at
// `packages/<name>/test/**`, mirroring the co-located vitest layout this
// project was split out of. No `#alias`
// path mapping is needed yet — packages import each other by workspace
// package name (`@battlestack/core`) or by relative path, same as tsconfig.
// `passWithNoTests` keeps `pnpm test` green for packages that don't have a
// `test/` directory yet (cli, preset-nuxt) until their suites land.
export default defineConfig({
    resolve: {
        // Since the build pipeline pass, each package's package.json
        // "exports" points at its `dist/` build output (required for
        // publishing — see the build/publish pipeline notes), not `src`.
        // Tests must run against source without requiring a `pnpm build`
        // first, so alias the workspace package names straight to source,
        // ahead of normal node_modules/exports resolution. Order matters:
        // the subpath regex (`@battlestack/core/utils/fs.js` etc., used by
        // ported feature files) must come before the bare-package alias.
        alias: [
            { find: /^@battlestack\/core\/(.*)\.js$/, replacement: `${src('core')}/$1.ts` },
            { find: /^@battlestack\/core$/, replacement: path.join(src('core'), 'index.ts') },
            { find: /^@battlestack\/tui$/, replacement: path.join(src('tui'), 'index.ts') },
            {
                find: /^@battlestack\/preset-nuxt4$/,
                replacement: path.join(src('preset-nuxt4'), 'index.ts'),
            },
        ],
    },
    test: {
        include: ['packages/*/test/**/*.{test,spec}.ts', 'scripts/test/**/*.{test,spec}.ts'],
        environment: 'node',
        globals: false,
        // 30s, not 10s. Several tests drive real deadlines (a DB-unreachable
        // probe, a readiness wait, a preflight directory scan) and a
        // `windows-latest` runner is slow enough under parallel load to blow a
        // 10s budget — the failures came in at 10006-10020ms, i.e. exactly the
        // timeout, and varied between Node legs of the same commit. They were
        // never assertion failures. A timeout that fires on runner speed rather
        // than on behaviour is a flaky gate, and a flaky gate gets ignored.
        //
        // This does not weaken anything: no test asserts that an operation is
        // FAST, so a larger ceiling cannot turn a real failure green. The
        // deadline tests pin their own budgets internally.
        testTimeout: 30_000,
        passWithNoTests: true,
        env: {
            // Pin colour OFF for the whole suite. Many tests assert on the
            // human-facing strings the commands print, and those go through
            // picocolors — which enables colour whenever `CI` is present in the
            // environment, not just on a TTY. So the suite behaved one way on a
            // developer's machine and another way on a runner, and
            // `doctor.test.ts`'s `/\bok\b/` failed on BOTH ubuntu-latest and
            // windows-latest the first time this repo's CI actually ran:
            // against `pc.green('ok')` the character before `o` is the `m` of
            // `\x1b[32m`, which is a word character, so `\b` never matches.
            // Reproducible on any machine with `CI=true pnpm test`.
            //
            // Pinned here rather than patched per-assertion, because the
            // failure mode — "an assertion sees escape codes it didn't expect"
            // — applies to every present and future assertion on printed
            // output, and only shows up in environments nobody runs locally.
            // NO_COLOR is picocolors' own kill switch, so printed strings are
            // now identical everywhere. Nothing in the suite asserts that
            // colour IS emitted; if something ever needs to, it should force
            // colour for that one case rather than unpinning this.
            NO_COLOR: '1',
        },
    },
})
