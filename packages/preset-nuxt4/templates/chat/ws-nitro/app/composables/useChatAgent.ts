interface ChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
}

export type ChatErrorKind = 'missing-key' | 'missing-url' | 'generic'

export interface ChatError {
    kind: ChatErrorKind
    message: string
}

function classifyError(raw: string): ChatError {
    if (/NUXT_(?:AI_GATEWAY|LITELLM)_KEY/i.test(raw)) return { kind: 'missing-key', message: raw }
    if (/NUXT_(?:AI_GATEWAY|LITELLM)_URL/i.test(raw)) return { kind: 'missing-url', message: raw }
    return { kind: 'generic', message: raw }
}

export function useChatAgent() {
    const messages = ref<ChatMessage[]>([])
    const input = ref('')
    const status = ref<'idle' | 'streaming'>('idle')
    const error = ref<ChatError | null>(null)
    let socket: WebSocket | null = null
    let assistantBuffer = ''
    let assistantId = ''

    function ensureSocket(): WebSocket {
        if (socket && socket.readyState === WebSocket.OPEN) return socket
        const url = new URL('/_ws', window.location.href)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        socket = new WebSocket(url.toString())
        socket.addEventListener('message', (e) => {
            const data = JSON.parse(e.data as string) as
                | { type: 'delta', content: string }
                | { type: 'done' }
                | { type: 'error', message: string }
            if (data.type === 'delta') {
                assistantBuffer += data.content
                const last = messages.value.at(-1)
                if (last && last.id === assistantId) last.content = assistantBuffer
            } else if (data.type === 'done') {
                status.value = 'idle'
            } else if (data.type === 'error') {
                status.value = 'idle'
                error.value = classifyError(data.message)
                // Drop the empty assistant placeholder so the error surfaces
                // instead of a phantom blank bubble.
                const last = messages.value.at(-1)
                if (last && last.id === assistantId && last.content === '') {
                    messages.value.pop()
                }
            }
        })
        socket.addEventListener('error', () => {
            status.value = 'idle'
            error.value = { kind: 'generic', message: 'WebSocket connection failed.' }
        })
        return socket
    }

    async function handleSubmit(e?: Event) {
        e?.preventDefault()
        const text = input.value.trim()
        if (!text || status.value === 'streaming') return

        error.value = null
        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: text,
        }
        assistantId = crypto.randomUUID()
        assistantBuffer = ''
        messages.value.push(userMsg, { id: assistantId, role: 'assistant', content: '' })
        input.value = ''
        status.value = 'streaming'

        const ws = ensureSocket()
        const send = () =>
            ws.send(
                JSON.stringify({
                    messages: messages.value
                        .filter((m) => m.role !== 'assistant' || m.content.length > 0)
                        .map((m) => ({ role: m.role, content: m.content })),
                }),
            )

        if (ws.readyState === WebSocket.OPEN) send()
        else ws.addEventListener('open', send, { once: true })
    }

    return { messages, input, handleSubmit, status, error }
}
