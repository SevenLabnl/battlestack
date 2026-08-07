export interface PreflightCheck {
    label: string
    state: 'ok' | 'warn' | 'fail'
    detail?: string
}

export interface PreflightInput {
    /** Package manager that will be used for installs. */
    pm: string
    /** True when nuxt4:database is part of the scaffold (requires docker). */
    needsDocker: boolean
    /** Minimum Node major version. Default 24. */
    minNodeMajor?: number
}
