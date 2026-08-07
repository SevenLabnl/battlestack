import ora, { type Ora } from 'ora'
import pc from 'picocolors'

export const sym = {
    ok: pc.green('✓'),
    fail: pc.red('✗'),
    warn: pc.yellow('!'),
    info: pc.cyan('›'),
    skip: pc.dim('·'),
    step: pc.cyan('›'),
    drift: pc.yellow('~'),
    missing: pc.red('✗'),
    pristine: pc.green('✓'),
    owned: pc.dim('='),
} as const

const c = {
    title: pc.bold,
    dim: pc.dim,
    accent: pc.cyan,
    good: pc.green,
    bad: pc.red,
    warn: pc.yellow,
} as const

export const color = c

// Single source of truth for the banner and `battlestack --help`.
export const TAGLINE = 'From zero to running app, fast'

// Plain wordmark, not ASCII art.
export function banner(version: string, tagline = TAGLINE): void {
    console.log('')
    console.log('  ' + pc.bold(pc.cyan('BATTLESTACK')))
    console.log('  ' + pc.dim(`v${version}  ·  ${tagline}`))
    console.log('')
}

/** Section header with a rule underneath, preceded by a blank line. */
export function section(title: string): void {
    console.log('')
    console.log(pc.bold(title))
    console.log(pc.dim('─'.repeat(Math.min(title.length, 60))))
}

export function hr(): void {
    console.log(pc.dim('─'.repeat(60)))
}

/** One-shot status lines. The period is added here. */
export function ok(msg: string): void {
    console.log(`${sym.ok} ${msg}.`)
}
export function fail(msg: string): void {
    console.log(`${sym.fail} ${msg}.`)
}
export function warn(msg: string): void {
    console.log(`${sym.warn} ${msg}.`)
}
export function info(msg: string): void {
    console.log(`${sym.info} ${msg}.`)
}
export function skip(msg: string): void {
    console.log(`${sym.skip} ${pc.dim(msg + '.')}`)
}
export function step(msg: string): void {
    console.log(`${sym.step} ${msg}`)
}
export function plain(msg: string): void {
    console.log(msg)
}
export function dim(msg: string): void {
    console.log(pc.dim(msg))
}
export function blank(): void {
    console.log('')
}

export function bullet(msg: string): void {
    console.log(`  ${pc.dim('•')} ${msg}`)
}

/** Aligned key/value rows: `  key   value`. */
export function kv(rows: Array<[string, string]>, indent = '  '): void {
    if (rows.length === 0) return
    const width = Math.max(...rows.map(([k]) => k.length))
    for (const [k, v] of rows) {
        console.log(`${indent}${pc.dim(k.padEnd(width))}  ${v}`)
    }
}

/** Recovery hint, shown under a fail/error. */
export function hint(msg: string): void {
    console.log(`  ${pc.dim('hint:')} ${pc.dim(msg)}`)
}

/** Debug line, only when --debug. */
export function debug(msg: string): void {
    console.log(pc.dim(`debug › ${msg}`))
}

/** Masks a secret, revealing the first and last 3 chars when long enough. */
export function maskSecret(v: string): string {
    if (v.length <= 8) return '*'.repeat(v.length)
    return `${v.slice(0, 3)}${'*'.repeat(v.length - 6)}${v.slice(-3)}`
}

/** A default spinner. The caller drives start/stop/succeed/fail. */
export function spinner(text?: string): Ora {
    return ora({ color: 'cyan', text })
}

// Active spinner registry. `run()` pauses and resumes it across inherited spawns.
let active: Ora | null = null

export function setActiveSpinner(s: Ora | null): void {
    active = s
}

export function withSpinnerPaused<T>(fn: () => Promise<T>): Promise<T> {
    const s = active
    const wasSpinning = !!s?.isSpinning
    const text = s?.text
    if (s && wasSpinning) s.stop()
    return fn().finally(() => {
        if (s && wasSpinning) {
            s.text = text ?? ''
            s.start()
        }
    })
}

/** Formats a CLIError for end-of-run failure output. */
export function printError(message: string, recoveryHint?: string, debugDetails?: string): void {
    console.log('')
    console.log(`${sym.fail} ${pc.red(message)}`)
    if (recoveryHint) hint(recoveryHint)
    if (debugDetails) {
        console.log('')
        console.log(pc.dim('debug ›'))
        console.log(pc.dim(debugDetails))
    }
    console.log('')
}

/** Wraps an exec command label for "running:" lines. */
export function cmd(label: string): string {
    return pc.cyan(label)
}
