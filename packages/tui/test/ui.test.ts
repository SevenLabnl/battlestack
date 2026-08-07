import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ui from '../src/ui.js'

let lines: string[]

function spyConsole(): void {
    lines = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        lines.push(args.join(' '))
    })
}

afterEach(() => {
    vi.restoreAllMocks()
    ui.setActiveSpinner(null)
})

describe('ui printers', () => {
    it('status lines carry their message', () => {
        spyConsole()
        ui.ok('all good')
        ui.fail('went wrong')
        ui.warn('careful')
        ui.info('fyi')
        ui.skip('skipped this')
        ui.step('doing thing')
        ui.plain('plain text')
        ui.dim('quiet text')
        ui.bullet('a bullet')
        ui.hint('a hint')
        const out = lines.join('\n')
        for (const expected of [
            'all good', 'went wrong', 'careful', 'fyi', 'skipped this',
            'doing thing', 'plain text', 'quiet text', 'a bullet', 'a hint',
        ]) {
            expect(out).toContain(expected)
        }
    })

    it('section prints the title; banner prints version + tagline', () => {
        spyConsole()
        ui.section('My Section')
        ui.banner('9.9.9')
        const out = lines.join('\n')
        expect(out).toContain('My Section')
        expect(out).toContain('9.9.9')
    })

    it('kv aligns keys and prints all rows', () => {
        spyConsole()
        ui.kv([['short', 'one'], ['a-much-longer-key', 'two']])
        const out = lines.join('\n')
        expect(out).toContain('short')
        expect(out).toContain('a-much-longer-key')
        expect(out).toContain('one')
        expect(out).toContain('two')
    })

    it('debug prefixes its output', () => {
        spyConsole()
        ui.debug('debug-message')
        expect(lines.join('\n')).toContain('debug-message')
    })

    it('printError shows message, recovery hint and debug details', () => {
        spyConsole()
        ui.printError('boom happened', 'try again', 'stack-trace-here')
        const out = lines.join('\n')
        expect(out).toContain('boom happened')
        expect(out).toContain('try again')
    })
})

describe('maskSecret', () => {
    it('keeps only a short prefix and suffix', () => {
        const masked = ui.maskSecret('sk-1234567890abcdefghij')
        expect(masked).not.toContain('567890abcdef')
        expect(masked.length).toBeLessThan('sk-1234567890abcdefghij'.length + 5)
    })

    it('handles short values without throwing', () => {
        expect(() => ui.maskSecret('ab')).not.toThrow()
    })
})

describe('withSpinnerPaused', () => {
    it('runs the wrapped fn and restores spinner state', async () => {
        const stops: string[] = []
        const fake = {
            isSpinning: true,
            text: 'spinning',
            stop() {
                stops.push('stop')
                return this
            },
            start() {
                stops.push('start')
                return this
            },
        }
        ui.setActiveSpinner(fake as never)
        const result = await ui.withSpinnerPaused(async () => 42)
        expect(result).toBe(42)
        expect(stops).toEqual(['stop', 'start'])
    })

    it('passes through when no spinner is active', async () => {
        ui.setActiveSpinner(null)
        expect(await ui.withSpinnerPaused(async () => 'ok')).toBe('ok')
    })
})

describe('cmd', () => {
    it('returns a string containing the label', () => {
        expect(ui.cmd('battlestack dev')).toContain('battlestack dev')
    })
})
