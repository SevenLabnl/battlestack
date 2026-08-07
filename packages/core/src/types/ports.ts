export type PortKind
    = | 'app'
        | 'db'
        | 'smtp'
        | 'mail-ui'
        | 's3-api'
        | 's3-console'
        | 'mastra-studio'
        | 'redis'

export interface ProjectPort {
    port: number
    label: string
    kind: PortKind
}
