/** Injectable logging/spinner seam. `packages/cli` installs the real one via `setUiPort`. */
export interface UiPort {
    /** Verbose-mode planning traces (`--debug`). No-op by default. */
    debug(msg: string): void
    /** Best-effort-failure warnings (skill install, update check, …). */
    warn(msg: string): void
    /** Low-emphasis one-liner (e.g. "could not auto-open browser"). */
    dim(msg: string): void
    /** Blank output line, paired with `warn`/`bullet` for the update-check banner. */
    blank(): void
    /** Indented follow-up line under a `warn`/`info`. */
    bullet(msg: string): void
    /** Status glyphs used inline when rendering a preflight-check list. */
    sym: { ok: string, warn: string, fail: string }
    /** Text-decoration helpers used inline (e.g. dimming a check's detail). */
    color: { dim: (s: string) => string }
    /** Run `fn` with any active spinner paused (e.g. around a child process that inherits the TTY). */
    withSpinnerPaused<T>(fn: () => T | Promise<T>): Promise<T>
    /** Track the "active" spinner so `withSpinnerPaused` has something to pause. Pass `null` to clear. */
    setActiveSpinner(spinner: unknown): void
}

const defaultPort: UiPort = {
    debug() {},
    warn(msg) {
        console.warn(msg)
    },
    dim(msg) {
        console.log(msg)
    },
    blank() {
        console.log('')
    },
    bullet(msg) {
        console.log(`  - ${msg}`)
    },
    sym: { ok: '✓', warn: '!', fail: '✗' },
    color: { dim: (s: string) => s },
    async withSpinnerPaused(fn) {
        return fn()
    },
    setActiveSpinner() {},
}

let current: UiPort = defaultPort

/** Install the real CLI-backed implementation. Called once at CLI startup. */
export function setUiPort(port: UiPort): void {
    current = port
}

/** The currently-installed port; defaults to a silent-ish console fallback. */
export function getUiPort(): UiPort {
    return current
}
