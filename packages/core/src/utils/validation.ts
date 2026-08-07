import path from 'node:path'
import { stat } from 'node:fs/promises'
import { CLIError, ErrorCode } from './errors.js'

const RESERVED = new Set([
    'node_modules',
    'favicon.ico',
    'package',
    'test',
    'tests',
    'dist',
    'build',
    'public',
    '.git',
    '.env',
    '.battlestack',
    '.nuxt',
    '.output',
    '.vscode',
    '.idea',
    'src',
    'lib',
])
const VALID_NAME = /^[a-z0-9][a-z0-9-_]*$/
const MAX_NAME_LEN = 64

const FORBIDDEN_CWD_PREFIXES_POSIX = ['/etc', '/sys', '/proc', '/dev', '/boot', '/var/log']

/** Env-derived Windows equivalents of `FORBIDDEN_CWD_PREFIXES_POSIX`. */
function forbiddenCwdPrefixesWin32(env: NodeJS.ProcessEnv): string[] {
    const systemRoot = env.SystemRoot ?? env.windir ?? 'C:\\Windows'
    const systemDrive = env.SystemDrive ?? 'C:'
    return [
        systemRoot,
        env.ProgramFiles ?? `${systemDrive}\\Program Files`,
        env['ProgramFiles(x86)'] ?? `${systemDrive}\\Program Files (x86)`,
        env.ProgramData ?? `${systemDrive}\\ProgramData`,
    ]
}

/** Case-insensitive on Windows, exact on POSIX. Containment matches `prefix + sep`. */
function isUnderPrefix(resolved: string, prefix: string, sep: string, win32: boolean): boolean {
    const a = win32 ? resolved.toLowerCase() : resolved
    const b = win32 ? prefix.toLowerCase() : prefix
    const withSep = b.endsWith(sep) ? b : b + sep
    return a === b || a === withSep || a.startsWith(withSep)
}

export function validateProjectName(name: string): void {
    if (!name) {
        throw new CLIError(ErrorCode.INVALID_PROJECT_NAME, 'Project name is required')
    }
    if (name.length > MAX_NAME_LEN) {
        throw new CLIError(
            ErrorCode.INVALID_PROJECT_NAME,
            `Project name too long (max ${MAX_NAME_LEN} chars)`,
        )
    }
    if (RESERVED.has(name)) {
        throw new CLIError(ErrorCode.INVALID_PROJECT_NAME, `"${name}" is reserved`)
    }
    if (!VALID_NAME.test(name)) {
        throw new CLIError(
            ErrorCode.INVALID_PROJECT_NAME,
            `Invalid project name "${name}". Use lowercase letters, digits, "-", "_".`,
        )
    }
}

/** The system-protected prefix `resolved` sits under, if any. `resolved` must be absolute. */
export function forbiddenSystemDirMatch(
    resolved: string,
    deps: { platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv } = {},
): string | undefined {
    const platform = deps.platform ?? process.platform
    const env = deps.env ?? process.env
    const win32 = platform === 'win32'
    const prefixes = win32 ? forbiddenCwdPrefixesWin32(env) : FORBIDDEN_CWD_PREFIXES_POSIX
    const sep = win32 ? '\\' : '/'
    return prefixes.find((prefix) => isUnderPrefix(resolved, prefix, sep, win32))
}

/** Accepts a `--cwd` that resolves to a real directory outside every system-protected prefix. */
export async function validateBaseDir(baseDir: string): Promise<void> {
    if (baseDir.includes('\0')) {
        throw new CLIError(ErrorCode.SCAFFOLD_FAILED, 'Invalid --cwd (contains NUL byte)')
    }
    const resolved = path.resolve(baseDir)
    if (forbiddenSystemDirMatch(resolved)) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Refusing to scaffold inside system directory: ${resolved}`,
        )
    }
    try {
        const st = await stat(resolved)
        if (!st.isDirectory()) {
            throw new CLIError(
                ErrorCode.SCAFFOLD_FAILED,
                `--cwd is not a directory: ${resolved}`,
            )
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new CLIError(
                ErrorCode.SCAFFOLD_FAILED,
                `--cwd does not exist: ${resolved}`,
            )
        }
        throw err
    }
}
