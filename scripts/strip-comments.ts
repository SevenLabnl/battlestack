import { parseSync } from 'vite'

/**
 * The AST of `src` without comments or source positions, or null when it does not parse.
 * Equal results mean the sources differ only in comments and formatting.
 */
export function stripComments(src: string): string | null {
    const { program, errors } = parseSync('feature.ts', src)
    if (errors.length > 0) return null
    return JSON.stringify(program, (key, value: unknown) => (key === 'start' || key === 'end' ? undefined : value))
}
