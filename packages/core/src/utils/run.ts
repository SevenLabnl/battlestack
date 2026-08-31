import { spawn, spawnSync } from 'node:child_process'
import { CLIError, ErrorCode } from './errors.js'
import type { RunOptions, RunResult } from '../types/run.js'
import { getUiPort } from '../ui-port.js'
import { resolveSpawn } from './win-exec.js'

/** Resets DECCKM, paste/focus/mouse/alt-screen and stty after a TTY child. */
function restoreTerminal(): void {
    try {
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
            process.stdin.setRawMode(false)
        }
    } catch {
        // tty already closed
    }
    if (process.stdout.isTTY) {
        try {
            process.stdout.write(
                '\x1b[?1l'
                + '\x1b[?25h'
                + '\x1b[?1004l'
                + '\x1b[?2004l'
                + '\x1b[?1000l'
                + '\x1b[?1002l'
                + '\x1b[?1003l'
                + '\x1b[?1005l'
                + '\x1b[?1006l'
                + '\x1b[?1015l'
                + '\x1b[?47l'
                + '\x1b[?1049l',
            )
        } catch {
            // stdout closed
        }
        try {
            spawnSync('stty', ['sane'], { stdio: 'inherit' })
        } catch {
            // stty unavailable (Windows, minimal containers)
        }
    }
}

/** No shell. Args are not interpolated. */
export async function run(
    command: string,
    args: string[],
    options: RunOptions = {},
): Promise<RunResult> {
    if (options.inherit) {
        return getUiPort().withSpinnerPaused(() => runInner(command, args, options))
    }
    return runInner(command, args, options)
}

function runInner(command: string, args: string[], options: RunOptions): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        // Error messages use the unresolved `command`/`args`.
        let resolved: ReturnType<typeof resolveSpawn>
        try {
            resolved = resolveSpawn(command, args, { cwd: options.cwd })
        } catch (err) {
            reject(new CLIError(ErrorCode.EXEC_FAILED, (err as Error).message, err))
            return
        }
        const child = spawn(resolved.file, resolved.args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: options.inherit ? 'inherit' : 'pipe',
            shell: resolved.shell,
            windowsVerbatimArguments: resolved.windowsVerbatimArguments,
        })

        let stdout = ''
        let stderr = ''

        // A timeout kill must reject, but `close` treats any signal as a clean
        // stop (Ctrl-C on an inherited child) — so the flag decides which.
        let timedOut = false
        let timer: NodeJS.Timeout | undefined
        if (options.timeoutMs) {
            timer = setTimeout(() => {
                timedOut = true
                try {
                    child.kill()
                } catch {
                    // child already gone
                }
            }, options.timeoutMs)
        }

        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString()
        })
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString()
        })

        // Forward signals to the inherited child.
        let detachHandlers: (() => void) | null = null
        if (options.inherit) {
            const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
            const handlers: Array<[NodeJS.Signals, () => void]> = signals.map((sig) => {
                const h = (): void => {
                    if (!child.killed) {
                        try {
                            child.kill(sig)
                        } catch {
                            // child already gone
                        }
                    }
                }
                process.on(sig, h)
                return [sig, h]
            })
            detachHandlers = () => {
                for (const [sig, h] of handlers) process.off(sig, h)
            }
        }

        child.on('error', (err) => {
            if (timer) clearTimeout(timer)
            detachHandlers?.()
            reject(new CLIError(ErrorCode.EXEC_FAILED, `Failed to spawn ${command}`, err))
        })

        child.on('close', (code, signal) => {
            if (timer) clearTimeout(timer)
            detachHandlers?.()
            if (timedOut) {
                reject(
                    new CLIError(
                        ErrorCode.EXEC_FAILED,
                        `${command} ${args.join(' ')} timed out after ${options.timeoutMs}ms`,
                    ),
                )
                return
            }
            // A signal-terminated child is not a failure.
            if (signal) {
                if (options.inherit) restoreTerminal()
                resolve({ stdout, stderr, code: 0 })
                return
            }
            const exit = code ?? 0
            if (exit !== 0) {
                // Last meaningful output line, stderr first then stdout.
                const lastLine = (s: string): string | undefined =>
                    s.trim().split(/\r?\n/).filter((l) => l.trim() !== '').at(-1)
                const detail = lastLine(stderr) ?? lastLine(stdout)
                const tail = detail ? `: ${detail}` : ''
                reject(
                    new CLIError(
                        ErrorCode.EXEC_FAILED,
                        `${command} ${args.join(' ')} exited with code ${exit}${tail}`,
                    ),
                )
                return
            }
            resolve({ stdout, stderr, code: exit })
        })
    })
}
