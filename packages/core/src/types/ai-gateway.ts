export interface GatewayModels {
    chat: string[]
    embedding: string[]
}

export type GatewayFetchError
    = | { kind: 'timeout' }
        | { kind: 'network', message: string }
        | { kind: 'http', status: number, statusText: string }
        | { kind: 'parse', message: string }
        | { kind: 'empty' }

export interface GatewayFetchResult {
    models: GatewayModels | null
    error: GatewayFetchError | null
}
