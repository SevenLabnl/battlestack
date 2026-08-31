export interface RunOptions {
    cwd?: string
    env?: NodeJS.ProcessEnv
    /** Inherit stdio for live output. Default: capture. */
    inherit?: boolean
    /** Kill the child and reject after this many ms. Default: no bound. */
    timeoutMs?: number
}

export interface RunResult {
    stdout: string
    stderr: string
    code: number
}
