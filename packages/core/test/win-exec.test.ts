import { describe, expect, it } from 'vitest'
import { findUnsafeShellArg, quoteWindowsArg, resolveSpawn } from '../src/utils/win-exec.js'

/** Fake filesystem: a Set of paths that "exist", checked case-sensitively (matches our real usage). */
function fakeExists(existing: string[]): (p: string) => boolean {
    const set = new Set(existing)
    return (p: string) => set.has(p)
}

describe('resolveSpawn: non-Windows', () => {
    it('is a byte-for-byte passthrough regardless of PATH contents', () => {
        const result = resolveSpawn('pnpm', ['install'], {
            deps: { platform: 'linux', exists: fakeExists([]) },
        })
        expect(result).toEqual({ file: 'pnpm', args: ['install'], shell: false })
    })

    it('passes through on darwin too', () => {
        const result = resolveSpawn('docker', ['--version'], {
            deps: { platform: 'darwin' },
        })
        expect(result).toEqual({ file: 'docker', args: ['--version'], shell: false })
    })
})

describe('resolveSpawn: Windows, native executables', () => {
    it('resolves a bare command to its .exe on PATH and keeps shell:false', () => {
        const result = resolveSpawn('docker', ['--version'], {
            deps: {
                platform: 'win32',
                pathEnv: String.raw`C:\Windows\system32;C:\tools\docker`,
                pathExt: '.COM;.EXE;.BAT;.CMD',
                cwd: String.raw`C:\work`,
                exists: fakeExists([String.raw`C:\tools\docker\docker.EXE`]),
            },
        })
        expect(result).toEqual({
            file: String.raw`C:\tools\docker\docker.EXE`,
            args: ['--version'],
            shell: false,
        })
    })

    it('checks cwd before PATH, mirroring Windows resolution order', () => {
        const result = resolveSpawn('tool', [], {
            deps: {
                platform: 'win32',
                pathEnv: String.raw`C:\somewhere-else`,
                cwd: String.raw`C:\work`,
                exists: fakeExists([String.raw`C:\work\tool.EXE`]),
            },
        })
        expect(result.file).toBe(String.raw`C:\work\tool.EXE`)
        expect(result.shell).toBe(false)
    })

    it('falls through unresolved commands unchanged so ENOENT still surfaces', () => {
        const result = resolveSpawn('does-not-exist', ['x'], {
            deps: { platform: 'win32', exists: fakeExists([]) },
        })
        expect(result).toEqual({ file: 'does-not-exist', args: ['x'], shell: false })
    })

    it('treats an already-extensioned absolute path as-is (no PATHEXT probing)', () => {
        const result = resolveSpawn(String.raw`C:\tools\node.exe`, ['-v'], {
            deps: {
                platform: 'win32',
                exists: fakeExists([String.raw`C:\tools\node.exe`]),
            },
        })
        expect(result).toEqual({ file: String.raw`C:\tools\node.exe`, args: ['-v'], shell: false })
    })
})

describe('resolveSpawn: Windows, .cmd/.bat shims', () => {
    const pnpmCmd = String.raw`C:\Users\dev\AppData\Roaming\npm\pnpm.CMD`

    function deps(existing: string[] = [pnpmCmd]) {
        return {
            platform: 'win32' as const,
            pathEnv: String.raw`C:\Users\dev\AppData\Roaming\npm`,
            pathExt: '.COM;.EXE;.BAT;.CMD',
            cwd: String.raw`C:\work`,
            exists: fakeExists(existing),
        }
    }

    it('routes a resolved .cmd shim through a single controlled cmd.exe /d /s /c', () => {
        const result = resolveSpawn('pnpm', ['install', '--config.confirmModulesPurge=false'], {
            deps: deps(),
        })
        expect(result.shell).toBe(false)
        expect(result.windowsVerbatimArguments).toBe(true)
        expect(result.file.toLowerCase()).toContain('cmd.exe')
        expect(result.args[0]).toBe('/d')
        expect(result.args[1]).toBe('/s')
        expect(result.args[2]).toBe('/c')
        expect(result.args[3]).toBe(`"${pnpmCmd} install --config.confirmModulesPurge=false"`)
    })

    it('quotes an argument containing spaces without treating it as unsafe', () => {
        const result = resolveSpawn('pnpm', ['dlx', 'nuxi@latest', 'init', String.raw`C:\Users\dev\My Projects\app`], {
            deps: deps(),
        })
        expect(result.args[3]).toContain(`"${String.raw`C:\Users\dev\My Projects\app`}"`)
    })

    it('throws instead of silently spawning when an argument carries a cmd.exe metacharacter', () => {
        expect(() =>
            resolveSpawn('pnpm', ['install', '&& calc.exe'], { deps: deps() }),
        ).toThrow(/unsafe|special/i)
    })

    it.each(['&', '|', '<', '>', '^', '%', '!', '"', '(', ')'])(
        'rejects the %s metacharacter',
        (ch) => {
            expect(() => resolveSpawn('pnpm', [`arg${ch}value`], { deps: deps() })).toThrow()
        },
    )

    it('never reaches the shell path for a native .exe resolution, even with unsafe-looking args', () => {
        // The metachar guard applies only to the shim branch; a native binary needs no
        // escaping because no shell is involved.
        const result = resolveSpawn('docker', ['run', '--env', 'FOO=a&b'], {
            deps: {
                platform: 'win32',
                pathEnv: String.raw`C:\tools`,
                exists: fakeExists([String.raw`C:\tools\docker.EXE`]),
            },
        })
        expect(result.shell).toBe(false)
        expect(result.args).toEqual(['run', '--env', 'FOO=a&b'])
    })
})

describe('quoteWindowsArg', () => {
    it('leaves simple arguments untouched', () => {
        expect(quoteWindowsArg('install')).toBe('install')
    })

    it('quotes arguments containing spaces', () => {
        expect(quoteWindowsArg('my project')).toBe('"my project"')
    })

    it('escapes embedded quotes and preceding backslashes (CommandLineToArgvW rules)', () => {
        expect(quoteWindowsArg('a "b" c')).toBe('"a \\"b\\" c"')
        // No space/quote at all → returned verbatim, trailing backslashes included.
        expect(quoteWindowsArg('C:\\foo\\bar\\')).toBe('C:\\foo\\bar\\')
        // A backslash before a quote must be doubled, or the quote reads as escaped.
        const backslashBeforeQuote = 'a\\"b' // literal: a \ " b
        expect(quoteWindowsArg(backslashBeforeQuote)).toBe('"a\\\\\\"b"')
    })

    it('quotes an empty argument as ""', () => {
        expect(quoteWindowsArg('')).toBe('""')
    })
})

describe('findUnsafeShellArg', () => {
    it('returns undefined when every arg is clean', () => {
        expect(findUnsafeShellArg(['install', '-D', 'foo-bar_1.2.3'])).toBeUndefined()
    })

    it('returns the first offending argument', () => {
        expect(findUnsafeShellArg(['ok', 'bad&arg', 'also&bad'])).toBe('bad&arg')
    })
})
