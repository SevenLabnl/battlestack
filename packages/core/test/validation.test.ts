import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    forbiddenSystemDirMatch,
    validateBaseDir,
    validateProjectName,
} from '../src/utils/validation.js'

describe('validateProjectName', () => {
    it('accepts simple lowercase names', () => {
        expect(() => validateProjectName('my-app')).not.toThrow()
        expect(() => validateProjectName('cool_project_42')).not.toThrow()
    })

    it('rejects reserved + framework dir names', () => {
        for (const reserved of ['node_modules', 'dist', 'build', '.git', '.env', '.battlestack']) {
            expect(() => validateProjectName(reserved)).toThrow(/reserved/i)
        }
    })

    it('rejects uppercase + special chars + leading punctuation', () => {
        expect(() => validateProjectName('MyApp')).toThrow(/invalid/i)
        expect(() => validateProjectName('my app')).toThrow(/invalid/i)
        expect(() => validateProjectName('-my-app')).toThrow(/invalid/i)
    })

    it('rejects empty + over-long names', () => {
        expect(() => validateProjectName('')).toThrow(/required/i)
        expect(() => validateProjectName('a'.repeat(65))).toThrow(/too long/i)
    })
})

describe('validateBaseDir', () => {
    let tmp: string
    beforeEach(async () => {
        tmp = await mkdtemp(path.join(os.tmpdir(), 'battlestack-cwd-test-'))
    })
    afterEach(async () => {
        await rm(tmp, { recursive: true, force: true })
    })

    it('accepts an existing writable directory', async () => {
        await expect(validateBaseDir(tmp)).resolves.toBeUndefined()
    })

    // Platform-split because the literals are not portable: on Windows
    // `path.resolve('/etc')` is `D:\etc`, which can never match a POSIX prefix list.
    it.skipIf(process.platform === 'win32')('rejects system-protected prefixes (POSIX)', async () => {
        await expect(validateBaseDir('/etc')).rejects.toThrow(/system directory/i)
        await expect(validateBaseDir('/sys/anywhere')).rejects.toThrow(/system directory/i)
        await expect(validateBaseDir('/proc/self')).rejects.toThrow(/system directory/i)
    })

    it.runIf(process.platform === 'win32')('rejects system-protected prefixes (Windows)', async () => {
        const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
        await expect(validateBaseDir(systemRoot)).rejects.toThrow(/system directory/i)
        await expect(validateBaseDir(path.join(systemRoot, 'System32'))).rejects.toThrow(
            /system directory/i,
        )
        await expect(validateBaseDir(process.env.ProgramData ?? 'C:\\ProgramData')).rejects.toThrow(
            /system directory/i,
        )
    })

    it('rejects NUL byte', async () => {
        await expect(validateBaseDir('/tmp/\0evil')).rejects.toThrow(/NUL byte/i)
    })

    it('rejects non-existent path', async () => {
        await expect(validateBaseDir(path.join(tmp, 'does-not-exist'))).rejects.toThrow(
            /does not exist/i,
        )
    })

    it('rejects a path that points at a file rather than a dir', async () => {
        const { writeFile } = await import('node:fs/promises')
        const filePath = path.join(tmp, 'not-a-dir.txt')
        await writeFile(filePath, 'x')
        await expect(validateBaseDir(filePath)).rejects.toThrow(/not a directory/i)
    })
})

/**
 * Platform is injected so the Windows branch runs on every host. The guard was a
 * complete no-op on Windows precisely because nothing here ever ran that path.
 */
describe('forbiddenSystemDirMatch', () => {
    const winEnv = {
        SystemRoot: 'C:\\Windows',
        SystemDrive: 'C:',
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        ProgramData: 'C:\\ProgramData',
    } as NodeJS.ProcessEnv
    const win = (p: string): string | undefined =>
        forbiddenSystemDirMatch(p, { platform: 'win32', env: winEnv })

    it('matches Windows system directories, exactly and by containment', () => {
        expect(win('C:\\Windows')).toBe('C:\\Windows')
        expect(win('C:\\Windows\\System32')).toBe('C:\\Windows')
        expect(win('C:\\Program Files\\nodejs')).toBe('C:\\Program Files')
        expect(win('C:\\Program Files (x86)')).toBe('C:\\Program Files (x86)')
        expect(win('C:\\ProgramData\\anything')).toBe('C:\\ProgramData')
    })

    it('matches case-insensitively on Windows', () => {
        // A case-sensitive compare would let `C:\WINDOWS\System32` through.
        expect(win('C:\\WINDOWS\\System32')).toBe('C:\\Windows')
        expect(win('c:\\program files\\nodejs')).toBe('C:\\Program Files')
    })

    it('does not match a sibling that merely shares the prefix string', () => {
        expect(win('C:\\Windows-old\\projects')).toBeUndefined()
        expect(win('C:\\Program Files Custom')).toBeUndefined()
    })

    it('allows ordinary Windows locations', () => {
        expect(win('C:\\Users\\alice\\projects')).toBeUndefined()
        expect(win('D:\\a\\battlestack\\battlestack')).toBeUndefined()
    })

    it('honours a relocated Windows install rather than assuming C:', () => {
        const relocated = { SystemRoot: 'E:\\Win', SystemDrive: 'E:' } as NodeJS.ProcessEnv
        expect(forbiddenSystemDirMatch('E:\\Win\\System32', { platform: 'win32', env: relocated }))
            .toBe('E:\\Win')
        // The conventional path is no longer protected there, which is correct.
        expect(forbiddenSystemDirMatch('C:\\Windows', { platform: 'win32', env: relocated }))
            .toBeUndefined()
    })

    it('keeps POSIX comparison case-sensitive', () => {
        const posix = (p: string): string | undefined =>
            forbiddenSystemDirMatch(p, { platform: 'linux', env: {} })
        expect(posix('/etc/nginx')).toBe('/etc')
        // `/ETC` is a genuinely different directory on POSIX.
        expect(posix('/ETC')).toBeUndefined()
        expect(posix('/home/alice/projects')).toBeUndefined()
    })
})
