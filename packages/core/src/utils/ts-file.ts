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

export function mergeShallow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target: any,
    key: string,
    patch: Record<string, unknown>,
): void {
    target[key] = { ...target[key], ...patch }
}
