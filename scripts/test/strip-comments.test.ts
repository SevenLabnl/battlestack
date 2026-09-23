import { describe, expect, it } from 'vitest'
import { stripComments } from '../strip-comments'

describe('stripComments', () => {
    it('treats a removed changelog line as no change', () => {
        const before = "export const f = {\n    id: 'x',\n    // 1.0.1: fixed a thing.\n    version: '1.0.1',\n}\n"
        const after = "export const f = {\n    id: 'x',\n    version: '1.0.1',\n}\n"
        expect(stripComments(before)).toBe(stripComments(after))
    })

    it('ignores doc, trailing and block comments', () => {
        const before = "/** doc */\nconst a = 1 // trailing\n/*\n * block\n */\nexport { a }\n"
        expect(stripComments(before)).toBe(stripComments('const a = 1\nexport { a }\n'))
    })

    it('reports a change to comment-looking text inside a template literal, since features emit it', () => {
        const before = 'export const t = `\n// old\n`\n'
        const after = 'export const t = `\n// new\n`\n'
        expect(stripComments(before)).not.toBe(stripComments(after))
    })

    it('reports a change inside a string that looks like a comment', () => {
        expect(stripComments("export const s = '// a'")).not.toBe(stripComments("export const s = '// b'"))
    })

    it('reports a code change', () => {
        expect(stripComments("export const v = '1.0.0'")).not.toBe(stripComments("export const v = '1.0.1'"))
    })

    it('returns null when the source does not parse', () => {
        expect(stripComments('const t = `open')).toBeNull()
    })
})
