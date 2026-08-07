import path from 'node:path'
import { ALL_NAMES } from './constants/identity.js'
import { dotDirName } from './utils/state-dir.js'
import { exists } from './utils/fs.js'

/** Walks up from `start` for a manifest under any known identity's state dir. Never mutates disk. */
export async function findProjectRoot(
    start: string,
    names: readonly string[] = ALL_NAMES,
): Promise<string | null> {
    let dir = path.resolve(start)
    while (true) {
        for (const name of names) {
            if (await exists(path.join(dir, dotDirName(name), 'manifest.json'))) return dir
        }
        const parent = path.dirname(dir)
        if (parent === dir) return null
        dir = parent
    }
}
