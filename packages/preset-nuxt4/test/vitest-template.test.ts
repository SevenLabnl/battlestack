import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const config = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../templates/vitest/vitest.config.ts')

describe('generated vitest.config.ts', () => {
    it('keeps watch mode out of Claude Code agent worktrees', async () => {
        const src = await readFile(config, 'utf8')
        expect(src).toMatch(/server:\s*\{\s*watch:\s*\{\s*ignored:\s*\[\s*'\*\*\/\.claude\/worktrees\/\*\*'\s*\]/)
    })
})
