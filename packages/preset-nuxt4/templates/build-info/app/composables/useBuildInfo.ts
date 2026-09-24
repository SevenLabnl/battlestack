/**
 * What this running instance actually is: which version, which commit, built when.
 *
 * Every value comes from `runtimeConfig.public`, which the production image sets from
 * `NUXT_PUBLIC_APP_*`. The Dockerfile bakes those in from its build args, so the answer
 * travels with the image rather than with the environment it happens to land in.
 *
 * A dev server has none of them and reports `dev` with an empty commit. That is the point:
 * an unknown commit must read as unknown, never as a plausible-looking one.
 */
export interface BuildInfo {
    /** Semver of the release this was built from, or `dev` outside a release build. */
    version: string
    /** Full 40-character commit sha, or `''` when the build did not supply one. */
    commit: string
    /** First 7 characters of `commit` — what `git log --oneline` and GitHub both show. */
    shortCommit: string
    /** ISO-8601 build timestamp, or `''`. */
    builtAt: string
    /** Link to the commit on the forge, or `''` when either the repo URL or the commit is missing. */
    commitUrl: string
}

export function useBuildInfo(): BuildInfo {
    const publicConfig = useRuntimeConfig().public as Record<string, unknown>

    const version = text(publicConfig.appVersion) || 'dev'
    const commit = text(publicConfig.appCommit)
    // Trailing slashes come from hand-set env vars far more often than not, and
    // `https://github.com/org/repo//commit/<sha>` 404s.
    const repoUrl = text(publicConfig.appRepoUrl).replace(/\/+$/, '')

    return {
        version,
        commit,
        shortCommit: commit.slice(0, 7),
        builtAt: text(publicConfig.appBuiltAt),
        commitUrl: repoUrl && commit ? `${repoUrl}/commit/${commit}` : '',
    }
}

/** Runtime config values survive an env round-trip as strings, but a nuxt.config edit can put anything here. */
function text(value: unknown): string {
    return typeof value === 'string' ? value : ''
}
