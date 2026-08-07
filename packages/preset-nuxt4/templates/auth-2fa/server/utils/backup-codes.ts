import { createHash, randomBytes } from 'node:crypto'

export const BACKUP_CODE_COUNT = 10

/** Generate single-use recovery codes formatted `xxxx-xxxx-xxxx-xxxx`. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
    return Array.from({ length: count }, () => {
        const bytes = randomBytes(8).toString('hex')
        return `${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}`
    })
}

export function hashBackupCode(code: string): string {
    return createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
}
