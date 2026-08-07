import path from 'node:path'
import { existsSync } from 'node:fs'
import {
    spawnSync,
    type SpawnSyncOptions,
    type SpawnSyncOptionsWithStringEncoding,
    type SpawnSyncReturns,
} from 'node:child_process'

export interface ResolveSpawnDeps {
    platform: NodeJS.Platform
    pathEnv: string
    pathExt: string
    exists: (p: string) => boolean
    cwd: string
    comspec: string
}

function defaultDeps(cwd?: string): ResolveSpawnDeps {
    return {
        platform: process.platform,
        pathEnv: process.env.PATH ?? process.env.Path ?? '',
        pathExt: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
        exists: existsSync,
        cwd: cwd ?? process.cwd(),
        comspec: process.env.ComSpec ?? 'cmd.exe',
    }
}

export interface ResolvedSpawn {
    file: string
    args: string[]
    shell: boolean
    windowsVerbatimArguments?: boolean
}

/** cmd.exe metacharacters plus quotes, `%`, `!`, parentheses and control chars. */
const REFUSED_CMD_CHARACTERS = /[&|<>^%!"'`()\r\n\0]/

export function findUnsafeShellArg(args: string[]): string | undefined {
    return args.find((a) => REFUSED_CMD_CHARACTERS.test(a))
}

/** `CommandLineToArgvW`-compatible argv-boundary quoting for one argv entry. */
export function quoteWindowsArg(arg: string): string {
    if (arg.length > 0 && !/[\s"]/.test(arg)) return arg
    let result = '"'
    let backslashes = 0
    for (const ch of arg) {
        if (ch === '\\') {
            backslashes++
            continue
        }
        if (ch === '"') {
            result += '\\'.repeat(backslashes * 2 + 1) + '"'
            backslashes = 0
            continue
        }
        result += '\\'.repeat(backslashes) + ch
        backslashes = 0
    }
    result += '\\'.repeat(backslashes * 2) + '"'
    return result
}

const SCRIPT_SHIM_EXTENSIONS = new Set(['.cmd', '.bat'])

function resolveOnWindowsPath(command: string, deps: ResolveSpawnDeps): string | null {
    const hasSep = command.includes('/') || command.includes('\\')
    const hasExt = /\.[^.\\/]+$/.test(path.win32.basename(command))
    const exts = hasExt ? [''] : deps.pathExt.split(';').filter(Boolean)
    const dirs = hasSep ? [''] : [deps.cwd, ...deps.pathEnv.split(path.win32.delimiter)]

    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = dir ? path.win32.join(dir, command + ext) : command + ext
            if (deps.exists(candidate)) return candidate
        }
    }
    return null
}

/** How to spawn `command` so package-manager shims work on Windows. */
export function resolveSpawn(
    command: string,
    args: string[],
    opts: { cwd?: string, deps?: Partial<ResolveSpawnDeps> } = {},
): ResolvedSpawn {
    const deps: ResolveSpawnDeps = { ...defaultDeps(opts.cwd), ...opts.deps }
    if (deps.platform !== 'win32') {
        return { file: command, args, shell: false }
    }

    const resolved = resolveOnWindowsPath(command, deps)
    if (!resolved) {
        return { file: command, args, shell: false }
    }

    const ext = path.win32.extname(resolved).toLowerCase()
    if (!SCRIPT_SHIM_EXTENSIONS.has(ext)) {
        return { file: resolved, args, shell: false }
    }

    const unsafe = findUnsafeShellArg(args)
    if (unsafe !== undefined) {
        throw new Error(
            `Refusing to run "${command}" (resolves to the Windows shim ${resolved}): `
            + `argument ${JSON.stringify(unsafe)} contains a character cmd.exe treats as `
            + `special, and quoting can't neutralize it safely. Install a native .exe of `
            + `this tool, or avoid that character.`,
        )
    }

    const inner = [quoteWindowsArg(resolved), ...args.map(quoteWindowsArg)].join(' ')
    return {
        file: deps.comspec,
        args: ['/d', '/s', '/c', `"${inner}"`],
        shell: false,
        windowsVerbatimArguments: true,
    }
}

/** `spawnSync` via {@link resolveSpawn}. A throw becomes an absent `status`. */
export function spawnSyncResolved(
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>
export function spawnSyncResolved(
    command: string,
    args: string[],
    options?: SpawnSyncOptions,
): SpawnSyncReturns<Buffer>
export function spawnSyncResolved(
    command: string,
    args: string[],
    options: SpawnSyncOptions = {},
): SpawnSyncReturns<string> | SpawnSyncReturns<Buffer> {
    try {
        const resolved = resolveSpawn(command, args, { cwd: options.cwd as string | undefined })
        return spawnSync(resolved.file, resolved.args, {
            ...options,
            shell: resolved.shell,
            windowsVerbatimArguments: resolved.windowsVerbatimArguments,
        }) as SpawnSyncReturns<string> | SpawnSyncReturns<Buffer>
    } catch (err) {
        const empty = options.encoding ? '' : Buffer.alloc(0)
        return {
            status: null,
            signal: null,
            pid: 0,
            output: [null, empty, empty],
            stdout: empty,
            stderr: empty,
            error: err as Error,
        } as SpawnSyncReturns<string> | SpawnSyncReturns<Buffer>
    }
}
