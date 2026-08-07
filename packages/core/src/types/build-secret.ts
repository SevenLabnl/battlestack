/** A Docker build-time secret, contributed via `Feature.collectBuildSecrets`. */
export interface BuildSecret {
    /** BuildKit mount id, e.g. `NPM_AUTH_TOKEN`. */
    id: string
    /** Env var name to export from the mounted secret file. Defaults to `id`. */
    env?: string
    /** Whether the install step should fail without it. Default `false` (best-effort). */
    required?: boolean
}
