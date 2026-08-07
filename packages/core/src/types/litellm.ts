export interface LiteLLMModels {
    chat: string[]
    embedding: string[]
}

export type LiteLLMFetchError
    = | { kind: 'timeout' }
        | { kind: 'network', message: string }
        | { kind: 'http', status: number, statusText: string }
        | { kind: 'parse', message: string }
        | { kind: 'empty' }

export interface LiteLLMFetchResult {
    models: LiteLLMModels | null
    error: LiteLLMFetchError | null
}
