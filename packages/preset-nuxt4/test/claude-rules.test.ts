import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { aiToolConfigFeature } from '../src/features/ai-tool-config.js'
import { mockRunContext } from './test-utils.js'

const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const RULES = path.join(TEMPLATES, 'ai-tool-config', 'claude-code', '.claude', 'rules')

/** Claude Code only reads `paths:` from a rule; a rule without it loads into every session. */
function pathsOf(content: string): string[] | null {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(content)
    if (!fm) return null
    return [...fm[1]!.matchAll(/^ {2}- "([^"]+)"$/gm)].map(m => m[1]!)
}

async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries.filter(e => e.isFile()).map(e => path.join(e.parentPath, e.name))
}

describe('Claude Code rules', () => {
    it('ships no Cursor-format .mdc rules or fake hooks.json', async () => {
        const all = await filesUnder(TEMPLATES)
        expect(all.filter(f => f.endsWith('.mdc'))).toEqual([])
        expect(all.filter(f => f.endsWith(`.claude${path.sep}hooks${path.sep}hooks.json`))).toEqual([])
    })

    it('documents exactly the shipped rules, with their real paths', async () => {
        const [section] = aiToolConfigFeature.collectDocs?.(mockRunContext()) ?? []
        const documented = new Map(
            [...section!.body.matchAll(/^- `([\w-]+\.md)` \((.+)\)$/gm)].map(m => [m[1]!, m[2]!]),
        )
        const shipped = (await readdir(RULES)).sort()
        expect([...documented.keys()].sort()).toEqual(shipped)

        for (const [file, globs] of documented) {
            const paths = pathsOf(await readFile(path.join(RULES, file), 'utf8'))
            if (globs === 'always loaded') expect(paths, file).toBeNull()
            else expect(paths?.join(', '), file).toBe(globs)
        }
    })
})
