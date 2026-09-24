/**
 * Boot work this replica must finish before it takes traffic. Nitro calls plugins without
 * awaiting them and starts listening at once, so `/api/health/ready` reads this instead.
 */

interface BootTaskOptions {
    /** A failure keeps readiness failing until the pod restarts, instead of only being logged. */
    fatal?: boolean
}

const pending = new Set<string>()
const failed = new Map<string, string>()
const settled = new Map<string, Promise<void>>()

/**
 * Runs `work` as a named boot task. Call it synchronously from a plugin body, so a later plugin's
 * `afterBootTask` finds it. Never rejects: a failure is logged and, if `fatal`, recorded.
 */
export function runBootTask(
    name: string,
    work: () => Promise<void>,
    options: BootTaskOptions = {},
): Promise<void> {
    pending.add(name)
    const done = (async () => {
        try {
            await work()
        } catch (err) {
            console.error(`[boot] ${name} failed:`, err)
            if (options.fatal) failed.set(name, err instanceof Error ? err.message : String(err))
        } finally {
            pending.delete(name)
        }
    })()
    settled.set(name, done)
    return done
}

/** Resolves once the named task has settled, or immediately if it was never started. */
export function afterBootTask(name: string): Promise<void> {
    return settled.get(name) ?? Promise.resolve()
}

export interface BootState {
    ready: boolean
    pending: string[]
    failed: Record<string, string>
}

export function bootState(): BootState {
    return {
        ready: pending.size === 0 && failed.size === 0,
        pending: [...pending],
        failed: Object.fromEntries(failed),
    }
}
