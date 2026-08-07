import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { exists } from './fs.js'
import { run } from './run.js'

/** Applies every `server/database/extensions/*.sql` in lexical order. */
export async function applyDbExtensions(projectDir: string): Promise<void> {
    const dir = path.join(projectDir, 'server/database/extensions')
    if (!(await exists(dir))) return
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b))
    if (files.length === 0) return

    for (const f of files) {
        const sql = (await readFile(path.join(dir, f), 'utf8')).trim()
        if (!sql) continue
        await run(
            'docker',
            [
                'compose',
                'exec',
                '-T',
                'db',
                'psql',
                '-U',
                'postgres',
                '-d',
                'app',
                '-v',
                'ON_ERROR_STOP=1',
                '-c',
                sql,
            ],
            { cwd: projectDir, inherit: true },
        )
    }
}

/** Whether the `users` table holds a row. `null` when the db is down or the table is absent. */
export async function usersTablePopulated(projectDir: string): Promise<boolean | null> {
    try {
        const result = await run(
            'docker',
            [
                'compose',
                'exec',
                '-T',
                'db',
                'psql',
                '-U',
                'postgres',
                '-d',
                'app',
                '-tAc',
                'SELECT EXISTS (SELECT 1 FROM users)',
            ],
            { cwd: projectDir, inherit: false },
        )
        const out = result.stdout.trim()
        if (out === 't') return true
        if (out === 'f') return false
        return null
    } catch {
        return null
    }
}

/** Polls until `SELECT 1` succeeds twice in a row, or `timeoutMs` elapses. */
export async function waitForPgReady(
    projectDir: string,
    timeoutMs = 60_000,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    let consecutiveOk = 0
    while (Date.now() < deadline) {
        try {
            await run(
                'docker',
                [
                    'compose',
                    'exec',
                    '-T',
                    'db',
                    'psql',
                    '-U',
                    'postgres',
                    '-d',
                    'app',
                    '-tAc',
                    'SELECT 1',
                ],
                { cwd: projectDir, inherit: false },
            )
            consecutiveOk++
            if (consecutiveOk >= 2) return true
            await new Promise((r) => setTimeout(r, 500))
        } catch {
            consecutiveOk = 0
            await new Promise((r) => setTimeout(r, 500))
        }
    }
    return false
}
