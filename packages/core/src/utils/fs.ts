import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function exists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

export async function ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
}

export async function writeFileEnsured(path: string, content: string): Promise<void> {
    await ensureDir(dirname(path))
    await writeFile(path, content, 'utf8')
}

export async function readJson<T = unknown>(path: string): Promise<T> {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
}

export async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFileEnsured(path, JSON.stringify(value, null, 4) + '\n')
}
