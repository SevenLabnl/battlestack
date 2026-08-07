declare module '#auth-utils' {
    interface User {
        id: string
        email: string
        name?: string
        role?: 'admin' | 'user'
        theme?: string
        locale?: string
    }

    interface SecureSessionData {
        sessionId: string
    }
}

export {}
