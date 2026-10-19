import { loadFile, writeFile } from 'magicast'

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
 * Edits the magicast node in place: rebuilding the object would reprint it, dropping
 * its comments and resetting every value the project changed.
 */
export function mergeDefaults(
    target: Record<string, unknown>,
    key: string,
    defaults: Record<string, unknown>,
): void {
    target[key] ||= {}
    const object = target[key] as Record<string, unknown>
    for (const [k, value] of Object.entries(defaults)) {
        const existing = object[k] as { $type?: string } | null | undefined
        if (existing === undefined) {
            object[k] = value
            continue
        }
        // magicast proxies an object literal as `$type: 'object'`; any other existing value is the project's.
        const nested = typeof value === 'object' && value !== null && !Array.isArray(value)
        if (nested && existing?.$type === 'object') mergeDefaults(object, k, value as Record<string, unknown>)
    }
}
