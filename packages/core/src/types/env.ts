export interface EnvVar {
    key: string
    /** Concrete value or factory written to `.env`. Factories run once per scaffold. */
    value?: string | (() => string)
    /** Placeholder for `.env.example`. Defaults to `value` if string, else 'replace-me'. */
    example?: string
    description?: string
    /** Marks the var as sensitive. */
    secret?: boolean
    /**
     * A self-owned secret the CLI generates (not an external credential): `randomBytes(bytes)` in
     * `encoding` (default `hex`). A `change-me` placeholder in an existing `.env` is upgraded too.
     */
    generate?: { bytes: number, encoding?: 'hex' | 'base64url' }
    /** Group label for `.env.example` (vars sharing a group share a section header). */
    group?: string
}

export interface EnvDiff {
    /** Keys appended to `.env` this run (project mode only). */
    newKeys: string[]
    /** Keys in `.env` whose value differs from the recommended value. Surfaced as suggestions. */
    valueChanged: { key: string, current: string, recommended: string }[]
    /** Self-owned secret keys whose placeholder value was replaced with a freshly generated one. */
    regenerated?: string[]
}
