import { describe, expect, it, vi } from 'vitest'

async function freshModule() {
    vi.resetModules()
    return import('#server/utils/boot-tasks')
}

function deferred(): { promise: Promise<void>, resolve: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
        resolve = r
    })
    return { promise, resolve }
}

async function fail(): Promise<void> {
    throw new Error('boom')
}

describe('boot tasks', () => {
    it('is not ready while a task is pending, and ready once it settles', async () => {
        const { runBootTask, bootState } = await freshModule()
        const gate = deferred()
        const done = runBootTask('slow', () => gate.promise)
        expect(bootState()).toMatchObject({ ready: false, pending: ['slow'] })
        gate.resolve()
        await done
        expect(bootState()).toEqual({ ready: true, pending: [], failed: {} })
    })

    it('keeps readiness failing after a fatal task fails', async () => {
        const { runBootTask, bootState } = await freshModule()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await runBootTask('migrate', fail, { fatal: true })
        expect(bootState()).toEqual({ ready: false, pending: [], failed: { migrate: 'boom' } })
    })

    it('only logs a non-fatal failure', async () => {
        const { runBootTask, bootState } = await freshModule()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await runBootTask('sync', fail)
        expect(bootState().ready).toBe(true)
    })

    it('afterBootTask waits for the named task and resolves at once for an unknown one', async () => {
        const { runBootTask, afterBootTask } = await freshModule()
        const order: string[] = []
        const gate = deferred()
        void runBootTask('migrate', async () => {
            await gate.promise
            order.push('migrate')
        })
        const dependent = afterBootTask('migrate').then(() => {
            order.push('sync')
        })
        await afterBootTask('never-started')
        expect(order).toEqual([])
        gate.resolve()
        await dependent
        expect(order).toEqual(['migrate', 'sync'])
    })
})
