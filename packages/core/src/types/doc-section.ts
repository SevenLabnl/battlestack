export interface DocSection {
    heading: string
    body: string
    /** 'readme' (user-facing), 'agents' (AI-coding-tool conventions; emitted as AGENTS.md), or both. */
    targets?: ('readme' | 'agents')[]
    /** Sort hint (lower runs earlier). Defaults to feature priority. */
    order?: number
}
