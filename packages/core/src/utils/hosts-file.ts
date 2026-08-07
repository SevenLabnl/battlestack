import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { run } from './run.js'
import { ALL_NAMES, CURRENT_NAME } from '../constants/identity.js'
import type { Platform } from '../types/platform.js'
import type { HostsEntry } from '../types/hosts-entry.js'

// macOS: /etc/hosts via `sudo cp`. Windows: hosts via PowerShell UAC. Linux unsupported.
export function platform(): Platform {
    const p = os.platform()
    if (p === 'darwin' || p === 'win32' || p === 'linux') return p
    return 'other'
}

export function hostsPath(): string {
    if (platform() === 'win32') {
        return path.join(
            process.env.SystemRoot ?? String.raw`C:\Windows`,
            'System32',
            'drivers',
            'etc',
            'hosts',
        )
    }
    return '/etc/hosts'
}

const MARKER = `# managed by ${CURRENT_NAME}`
const markerFor = (name: string): string => `# managed by ${name}`

export async function ensureHostsEntry(entry: HostsEntry): Promise<boolean> {
    const file = hostsPath()
    const current = await readFile(file, 'utf8').catch(() => '')
    if (hasEntry(current, entry)) return false
    await writeWithElevation(file, appendEntry(current, entry))
    return true
}

/** Matches every known name's marker, not only the current one. `names` is test-only. */
export async function removeHostsEntry(
    entry: HostsEntry,
    names: readonly string[] = ALL_NAMES,
): Promise<boolean> {
    const file = hostsPath()
    const current = await readFile(file, 'utf8').catch(() => '')
    if (!hasEntry(current, entry)) return false
    await writeWithElevation(file, stripEntry(current, entry, names))
    return true
}

function hasEntry(content: string, entry: HostsEntry): boolean {
    const re = new RegExp(
        String.raw`^\s*${escapeRe(entry.ip)}\s+([^#\n]+\s+)?${escapeRe(entry.hostname)}(\s|$)`,
        'm',
    )
    return re.test(content)
}

function appendEntry(content: string, entry: HostsEntry): string {
    const trailing = content.endsWith('\n') ? '' : '\n'
    return `${content}${trailing}${entry.ip}\t${entry.hostname}\t${MARKER}\n`
}

function stripEntry(content: string, entry: HostsEntry, names: readonly string[]): string {
    const markerPattern = names.map((n) => escapeRe(markerFor(n))).join('|')
    const re = new RegExp(
        String.raw`^\s*${escapeRe(entry.ip)}\s+${escapeRe(entry.hostname)}\s+(?:${markerPattern})\s*\n?`,
        'gm',
    )
    return content.replaceAll(re, '')
}

function escapeRe(s: string): string {
    return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

async function writeWithElevation(target: string, contents: string): Promise<void> {
    const tmp = path.join(
        os.tmpdir(),
        `battlestack-hosts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    await writeFile(tmp, contents)

    const p = platform()
    if (p === 'darwin') {
        await run('sudo', ['cp', tmp, target], { inherit: true })
        return
    }
    if (p === 'win32') {
        // PowerShell single-quote escaping: ' → ''
        const tmpQuoted = tmp.replaceAll('\'', '\'\'')
        const targetQuoted = target.replaceAll('\'', '\'\'')
        const ps = [
            `Start-Process`,
            `powershell`,
            `-ArgumentList`,
            `'-NoProfile','-Command','Copy-Item','-Force','-Path','${tmpQuoted}','-Destination','${targetQuoted}'`,
            `-Verb`,
            `RunAs`,
            `-Wait`,
        ].join(' ')
        await run('powershell', ['-NoProfile', '-Command', ps], { inherit: true })
        return
    }
    throw new Error(`hosts-file editing on ${p} is not supported yet`)
}
