import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Parses `<projectDir>/.env` into a key→value map, empty when missing. Handles `export`
 * prefixes, `#` comments and quoted values. No interpolation.
 */
export async function readDotEnv(projectDir: string): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    let content: string
    try {
        content = await readFile(path.join(projectDir, '.env'), 'utf8')
    } catch {
        return out
    }
    for (const raw of content.split(/\r?\n/)) {
        const entry = parseLine(raw)
        if (entry) out.set(entry.key, entry.value)
    }
    return out
}

function parseLine(raw: string): { key: string, value: string } | null {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return null
    const stripped = line.startsWith('export ') ? line.slice(7) : line
    const eq = stripped.indexOf('=')
    if (eq <= 0) return null
    const key = stripped.slice(0, eq).trim()
    if (!/^[A-Za-z_]\w*$/.test(key)) return null
    return { key, value: parseValue(stripped.slice(eq + 1).trim()) }
}

function parseValue(value: string): string {
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        return value
            .slice(1, -1)
            .replaceAll(String.raw`\n`, '\n')
            .replaceAll(String.raw`\r`, '\r')
            .replaceAll(String.raw`\t`, '\t')
            .replaceAll(String.raw`\"`, '"')
            .replaceAll(String.raw`\\`, '\\')
    }
    if (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2) {
        return value.slice(1, -1)
    }
    const hash = value.indexOf(' #')
    return hash >= 0 ? value.slice(0, hash).trimEnd() : value
}
