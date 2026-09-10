export interface DocSection {
    heading: string
    body: string
    /**
     * 'agents' emits into AGENTS.md. 'readme' is no longer consumed: README.md is a fixed
     * Quick start plus a pointer, so every section lands in AGENTS.md only. Kept in the union
     * so the features declaring it need no edit.
     */
    targets?: ('readme' | 'agents')[]
    /** Sort hint (lower runs earlier). Defaults to feature priority. */
    order?: number
}
