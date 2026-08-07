import type { PackageManager } from '@battlestack/core'

/** Package-manager substitution for emitted templates. */

/** Substitutes `__KEY__` placeholders. A line that is only an empty-rendering placeholder is dropped. */
export function applyVars(raw: string, vars: Record<string, string>): string {
    const lines = raw.split('\n')
    const out: string[] = []

    for (const line of lines) {
        const soleToken = /^\s*__([A-Z0-9_]+)__\s*$/.exec(line)
        if (soleToken && vars[soleToken[1]!] === '') continue

        let rendered = line
        for (const [k, v] of Object.entries(vars)) rendered = rendered.split(`__${k}__`).join(v)
        out.push(rendered)
    }

    return out.join('\n')
}

/** The placeholder set for one package manager. `PM_SETUP` is a whole workflow step. */
export function renderPmVars(pm: PackageManager): Record<string, string> {
    switch (pm) {
        case 'pnpm':
            return {
                PM_SETUP: [
                    '      - uses: pnpm/action-setup@v6',
                    '        with:',
                    '          version: 10',
                ].join('\n'),
                PM_CACHE: '          cache: pnpm',
                PM_INSTALL: 'pnpm install --frozen-lockfile',
                PM_EXEC: 'pnpm exec',
                PM_RUN: 'pnpm run',
                PM_AUDIT: 'pnpm audit',
            }
        case 'npm':
            return {
                // `actions/setup-node` ships npm.
                PM_SETUP: '',
                PM_CACHE: '          cache: npm',
                // `npm ci` is the counterpart of `--frozen-lockfile`.
                PM_INSTALL: 'npm ci',
                PM_EXEC: 'npx',
                PM_RUN: 'npm run',
                PM_AUDIT: 'npm audit',
            }
        case 'bun':
            return {
                PM_SETUP: [
                    '      - uses: oven-sh/setup-bun@v2',
                    '        with:',
                    '          bun-version: latest',
                ].join('\n'),
                // `actions/setup-node` accepts no bun cache key; `oven-sh/setup-bun` caches itself.
                PM_CACHE: '',
                PM_INSTALL: 'bun install --frozen-lockfile',
                PM_EXEC: 'bunx',
                PM_RUN: 'bun run',
                PM_AUDIT: 'bun audit',
            }
    }
}
