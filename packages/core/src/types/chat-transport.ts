/**
 * `ws-nitro` (default) is a Nitro WebSocket at `/_ws`. `http` is a Vercel-AI-SDK chunked
 * stream at `/api/chat`, manual opt-in only.
 */
export type ChatTransport = 'ws-nitro' | 'http'
