import { loadFile, writeFile } from 'magicast'
import { CLIError, ErrorCode } from './errors.js'

type Mod = Awaited<ReturnType<typeof loadFile>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defaultObject(mod: Mod): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = (mod.exports as any).default
    if (def?.$type === 'function-call') return def.$args[0]
    return def
}

export async function patchTsFile(
    filePath: string,
    fn: (mod: Mod) => unknown,
): Promise<void> {
    const mod = await loadFile(filePath)
    await fn(mod)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeFile(mod as any, filePath)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pushUnique(arr: any, value: unknown): void {
    if (![...arr].includes(value)) arr.push(value)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pushUniqueAll(arr: any, values: unknown[]): void {
    for (const v of values) pushUnique(arr, v)
}

/**
 * Adds the keys of `defaults` that `target[key]` lacks, recursing into nested objects.
 * Returns the paths of the defaults left out because the project's value above them is not an object literal.
 * Edits the magicast node in place: rebuilding the object would reprint it, dropping
 * its comments and resetting every value the project changed.
 */
export function mergeDefaults(
    target: Record<string, unknown>,
    key: string,
    defaults: Record<string, unknown>,
    label: string = key,
): string[] {
    const object = objectLiteralAt(target, key, label)
    const skipped: string[] = []
    for (const [k, value] of Object.entries(defaults)) {
        // magicast reads a literal `null` back as undefined, so presence is checked by key: a null is the project's.
        if (!(k in object)) {
            object[k] = value
            continue
        }
        const nested = typeof value === 'object' && value !== null && !Array.isArray(value)
        if (!nested) continue
        if (isObjectLiteral(object[k])) {
            skipped.push(...mergeDefaults(object, k, value as Record<string, unknown>, `${label}.${k}`))
        } else {
            skipped.push(...Object.keys(value).map((sub) => `${label}.${k}.${sub}`))
        }
    }
    return skipped
}

export function objectLiteralAt(
    target: Record<string, unknown>,
    key: string,
    label: string = key,
): Record<string, unknown> {
    if (!(key in target)) target[key] = {}
    if (!isObjectLiteral(target[key])) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `${label} is not an object literal, so battlestack cannot add its keys to it. `
            + `Write ${label} as an inline object (not a variable, shorthand or other expression), then re-run.`,
        )
    }
    return target[key] as Record<string, unknown>
}

function isObjectLiteral(value: unknown): boolean {
    return (value as { $type?: string } | undefined)?.$type === 'object'
}
