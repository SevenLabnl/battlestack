import { createRequire } from 'node:module'

type ParseSync = typeof import('vite').parseSync

let parser: ParseSync | null | undefined

/** Loaded on first use: the Dependabot bump workflow runs bump-check with no packages installed. */
function loadParser(): ParseSync | null {
    if (parser !== undefined) return parser
    try {
        parser = (createRequire(import.meta.url)('vite') as typeof import('vite')).parseSync
    } catch {
        parser = null
    }
    return parser
}

/**
 * The AST of `src` without comments or source positions, or null when it does not parse or no
 * parser is installed. Equal results mean the sources differ only in comments and formatting.
 */
export function stripComments(src: string): string | null {
    const parseSync = loadParser()
    if (!parseSync) return null
    const { program, errors } = parseSync('feature.ts', src)
    if (errors.length > 0) return null
    return JSON.stringify(program, (key, value: unknown) => (key === 'start' || key === 'end' ? undefined : value))
}
