import { useChat } from '@ai-sdk/vue'

/** Chat composable backed by `/api/chat`. */
export function useChatAgent() {
    return useChat({
        api: '/api/chat',
    })
}
