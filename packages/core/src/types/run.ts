export interface RunOptions {
    cwd?: string
    env?: NodeJS.ProcessEnv
    /** Inherit stdio for live output. Default: capture. */
    inherit?: boolean
}

export interface RunResult {
    stdout: string
    stderr: string
    code: number
}
