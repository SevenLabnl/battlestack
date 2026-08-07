import type { H3Event } from 'h3'

/** Get the client IP from `cf-connecting-ip` or the socket. */
export function getClientIP(event: H3Event): string {
    const cf = getRequestHeader(event, 'cf-connecting-ip')
    if (cf) return cf
    return event.node.req.socket?.remoteAddress ?? 'unknown'
}
