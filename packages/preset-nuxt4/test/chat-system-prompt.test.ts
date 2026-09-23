import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Mastra appends a `system` option or a `role: 'system'` message after the agent's instructions
 * instead of replacing them, so the model gets two system prompts. `instructions` replaces.
 */

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

async function walk(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...await walk(full))
        else if (entry.name.endsWith('.ts')) out.push(full)
    }
    return out
}

describe('one system prompt per Mastra call', () => {
    it('no template passes a `system` option to an agent call', async () => {
        const offenders: string[] = []
        for (const file of await walk(templates)) {
            const src = await readFile(file, 'utf8')
            if (/\.(generate|stream)\([^)]*\{[^}]*\bsystem\s*:/s.test(src)) offenders.push(path.relative(templates, file))
        }
        expect(offenders).toEqual([])
    })

    it.each(['chat/http/server/api/chat.post.ts', 'chat/ws-nitro/server/routes/_ws.ts'])('%s accepts only user and assistant messages', async (rel) => {
        const src = await readFile(path.join(templates, rel), 'utf8')
        expect(src).not.toMatch(/['"]system['"]/)
        expect(src).toMatch(/['"]user['"]/)
        expect(src).toMatch(/['"]assistant['"]/)
    })

    it('the WebSocket route authenticates the upgrade and every message', async () => {
        const src = await readFile(path.join(templates, 'chat/ws-nitro/server/routes/_ws.ts'), 'utf8')
        expect(src).toMatch(/async upgrade\(request\)/)
        expect(src).toMatch(/originAllowed\(request\.headers\)/)
        const upgrade = src.slice(src.indexOf('async upgrade('), src.indexOf('async message('))
        const message = src.slice(src.indexOf('async message('))
        expect(upgrade).toMatch(/isSessionLive/)
        expect(message).toMatch(/isSessionLive/)
        expect(message).toMatch(/checkRateLimit/)
    })
})
