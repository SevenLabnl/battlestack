import { rename } from 'node:fs/promises'
import path from 'node:path'
import { ALL_NAMES, CURRENT_NAME, PRIOR_NAMES } from '../constants/identity.js'
import { exists } from './fs.js'

/** The dot-directory name for a given product identity, e.g. `.battlestack`. */
export const dotDirName = (name: string): string => `.${name}`

/** The state-directory NAME (not a full path) under the current identity. */
export const STATE_DIR = dotDirName(CURRENT_NAME)

/** Adopts a prior-identity directory with one atomic rename. */
export async function migrateStateDir(
    baseDir: string,
    opts: { current?: string, prior?: readonly string[] } = {},
): Promise<boolean> {
    const current = opts.current ?? CURRENT_NAME
    const prior = opts.prior ?? PRIOR_NAMES
    const currentDir = path.join(baseDir, dotDirName(current))
    if (await exists(currentDir)) return false
    for (const name of prior) {
        const priorDir = path.join(baseDir, dotDirName(name))
        if (await exists(priorDir)) {
            await rename(priorDir, currentDir)
            return true
        }
    }
    return false
}

/** Migrates a prior-name directory forward, then returns the current-name path. */
export async function resolveStateDir(
    baseDir: string,
    opts: { current?: string, prior?: readonly string[] } = {},
): Promise<string> {
    await migrateStateDir(baseDir, opts)
    return path.join(baseDir, dotDirName(opts.current ?? CURRENT_NAME))
}

/** Read-only existence probe across every known identity, current first. Migrates nothing. */
export async function findStateDir(
    baseDir: string,
    names: readonly string[] = ALL_NAMES,
): Promise<string | null> {
    for (const name of names) {
        const dir = path.join(baseDir, dotDirName(name))
        if (await exists(dir)) return dir
    }
    return null
}
