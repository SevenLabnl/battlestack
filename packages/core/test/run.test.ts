import os from 'node:os'
import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { run } from '../src/utils/run.js'

describe('run', () => {
    it('captures stdout from a successful command', async () => {
        const result = await run('node', ['-e', 'console.log("hello-stdout")'])
        expect(result.stdout).toContain('hello-stdout')
        expect(result.code).toBe(0)
    })

    it('captures stderr separately', async () => {
        const result = await run('node', ['-e', 'console.error("warn-stderr")'])
        expect(result.stderr).toContain('warn-stderr')
        expect(result.stdout).not.toContain('warn-stderr')
    })

    it('rejects with a CLIError on non-zero exit', async () => {
        await expect(run('node', ['-e', 'process.exit(3)'])).rejects.toThrow(/exited|code/i)
    })

    it('error message includes the last stderr line', async () => {
        await expect(
            run('node', ['-e', 'console.error("first"); console.error("real cause"); process.exit(1)']),
        ).rejects.toThrow(/real cause/)
    })

    it('error message falls back to the last stdout line when stderr is empty', async () => {
        // pnpm/npm print most errors to stdout, so the tail must not be lost.
        await expect(
            run('node', ['-e', 'console.log("ELIFECYCLE boom"); process.exit(1)']),
        ).rejects.toThrow(/ELIFECYCLE boom/)
    })

    it('error tail skips trailing blank lines', async () => {
        await expect(
            run('node', ['-e', 'console.log("the cause\\n\\n\\n"); process.exit(1)']),
        ).rejects.toThrow(/the cause/)
    })

    it('rejects when the binary does not exist', async () => {
        await expect(run('definitely-not-a-binary-xyz', [])).rejects.toThrow()
    })

    it('passes env overrides to the child', async () => {
        const result = await run('node', ['-e', 'console.log(process.env.RUN_TEST_VAR)'], {
            env: { RUN_TEST_VAR: 'env-override-ok' },
        })
        expect(result.stdout).toContain('env-override-ok')
    })

    it('respects cwd', async () => {
        // `os.tmpdir()`, not `/tmp`: on Windows that is a nonexistent `D:\tmp` and Node
        // reports ENOENT against the *executable*, which reads as a win-exec bug.
        const dir = await realpath(os.tmpdir())
        const result = await run('node', ['-e', 'console.log(process.cwd())'], { cwd: dir })
        expect(await realpath(result.stdout.trim())).toBe(dir)
        // Guards the assertion above against passing on any cwd: the test process's own
        // directory must not be the one we asked for.
        expect(path.resolve(dir)).not.toBe(path.resolve(process.cwd()))
    })

    // A timeout kill must reject, not take the "signal-terminated children are
    // not failures" path — that path is for the user's own Ctrl-C.
    it('rejects a child that outlives timeoutMs', async () => {
        await expect(
            run('node', ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 200 }),
        ).rejects.toThrow(/timed out after 200ms/)
    })

    it('leaves a child that finishes in time alone', async () => {
        const result = await run('node', ['-e', 'console.log("quick")'], { timeoutMs: 5000 })
        expect(result.stdout).toContain('quick')
    })
})
