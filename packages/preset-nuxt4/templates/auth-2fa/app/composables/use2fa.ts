/** Client wrapper around the 2FA endpoints. */
export function use2fa() {
    async function status(): Promise<{ enabled: boolean; enabledAt: string | null }> {
        return $fetch<{ enabled: boolean; enabledAt: string | null }>('/api/auth/2fa/status')
    }

    async function setup(): Promise<{ secret: string; otpauthUrl: string }> {
        return $fetch<{ secret: string; otpauthUrl: string }>('/api/auth/2fa/setup', { method: 'POST' })
    }

    // Enabling 2FA also returns the freshly-generated backup codes (shown once).
    async function verify(code: string): Promise<{ ok: true; backupCodes: string[] }> {
        return $fetch<{ ok: true; backupCodes: string[] }>('/api/auth/2fa/verify', { method: 'POST', body: { code } })
    }

    async function disable(code: string): Promise<{ ok: true }> {
        return $fetch<{ ok: true }>('/api/auth/2fa/disable', { method: 'POST', body: { code } })
    }

    async function backupCodesStatus(): Promise<{ unused: number }> {
        return $fetch<{ unused: number }>('/api/auth/2fa/backup-codes')
    }

    async function generateBackupCodes(): Promise<{ codes: string[] }> {
        return $fetch<{ codes: string[] }>('/api/auth/2fa/backup-codes/generate', { method: 'POST' })
    }

    async function redeemBackupCode(code: string): Promise<{ ok: true }> {
        return $fetch<{ ok: true }>('/api/auth/2fa/backup-codes/redeem', {
            method: 'POST',
            body: { code },
        })
    }

    return {
        status,
        setup,
        verify,
        disable,
        backupCodesStatus,
        generateBackupCodes,
        redeemBackupCode,
    }
}
