/**
 * h3's `createError({ statusMessage })` lands in the response body; ofetch exposes it as `error.data`, not `error.statusMessage`.
 * Server messages on enumeration-sensitive paths (login, forgot-password, resend-verification) must stay vague since this surfaces them verbatim.
 */
export function serverErrorMessage(e: unknown, fallback: string): string {
    const err = e as {
        data?: { statusMessage?: string; message?: string }
        statusMessage?: string
    }
    return err.data?.statusMessage || err.data?.message || err.statusMessage || fallback
}
