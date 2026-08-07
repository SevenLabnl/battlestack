import path from 'node:path'
import { exists, readJson, writeJson } from './utils/fs.js'
import type { LocalState } from './types/local-state.js'
import { migrateStateDir, STATE_DIR } from './utils/state-dir.js'

export const LOCAL_STATE_PATH = `${STATE_DIR}/local.json`

export async function readLocalState(projectDir: string): Promise<LocalState | null> {
    await migrateStateDir(projectDir)
    const target = path.join(projectDir, LOCAL_STATE_PATH)
    if (!(await exists(target))) return null
    return readJson<LocalState>(target)
}

export async function writeLocalState(projectDir: string, state: LocalState): Promise<void> {
    await migrateStateDir(projectDir)
    const target = path.join(projectDir, LOCAL_STATE_PATH)
    await writeJson(target, state)
}
