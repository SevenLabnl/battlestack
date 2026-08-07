import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { CLIError, ErrorCode } from './errors.js'
import { exists } from './fs.js'
import { migrateStateDir, STATE_DIR } from './state-dir.js'

const LOCK_REL = `${STATE_DIR}/lock`
const STALE_AFTER_MS = 30 * 60 * 1000

interface LockData {
    pid: number
    hostname: string
    startedAt: string
    command: string
}

/**
 * Acquires `.battlestack/lock`. A live same-machine pid throws; a lock older than 30 minutes
 * or held by a dead pid is reclaimed. Returns a release fn for `finally`.
 */
export async function acquireProjectLock(
    projectDir: string,
    command: string,
): Promise<() => Promise<void>> {
    await migrateStateDir(projectDir)
    const lockPath = path.join(projectDir, LOCK_REL)
    await mkdir(path.dirname(lockPath), { recursive: true })

    if (await exists(lockPath)) {
        const existing = await readLock(lockPath)
        if (existing && isLive(existing)) {
            throw new CLIError(
                ErrorCode.SCAFFOLD_FAILED,
                `Another battlestack process is already running on this project `
                + `(pid ${existing.pid}, started ${existing.startedAt}, command "${existing.command}"). `
                + `Wait for it to finish or kill it; remove ${LOCK_REL} manually if you're certain it's dead.`,
            )
        }
    }

    const data: LockData = {
        pid: process.pid,
        hostname: hostname(),
        startedAt: new Date().toISOString(),
        command,
    }
    await writeFile(lockPath, JSON.stringify(data, null, 2) + '\n', 'utf8')

    let released = false
    const onExit = (): void => {
        void release()
    }
    const release = async (): Promise<void> => {
        if (released) return
        released = true
        process.off('exit', onExit)
        process.off('SIGINT', onExit)
        process.off('SIGTERM', onExit)
        await rm(lockPath, { force: true })
    }

    process.once('exit', onExit)
    process.once('SIGINT', onExit)
    process.once('SIGTERM', onExit)

    return release
}

async function readLock(lockPath: string): Promise<LockData | null> {
    try {
        const raw = await readFile(lockPath, 'utf8')
        return JSON.parse(raw) as LockData
    } catch {
        return null
    }
}

function isLive(lock: LockData): boolean {
    const ageMs = Date.now() - new Date(lock.startedAt).getTime()
    if (Number.isNaN(ageMs) || ageMs > STALE_AFTER_MS) return false
    try {
        process.kill(lock.pid, 0)
        return true
    } catch {
        return false
    }
}
