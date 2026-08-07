export const PASSWORD_MIN_LENGTH = 12

const COMMON_PASSWORDS = new Set([
    'password',
    'password1',
    'password123',
    'qwerty',
    'qwerty123',
    'letmein',
    'welcome',
    'admin',
    'admin123',
    '123456',
    '12345678',
    '123456789',
    '1234567890',
    'iloveyou',
    'monkey',
    'dragon',
])

export type PasswordCheck = { valid: true } | { valid: false; error: string }

export function checkPasswordPolicy(password: string): PasswordCheck {
    if (password.length < PASSWORD_MIN_LENGTH) {
        return {
            valid: false,
            error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
        }
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, error: 'Password must contain a lowercase letter' }
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain an uppercase letter' }
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain a digit' }
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain a symbol' }
    }
    const normalized = password.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const common of COMMON_PASSWORDS) {
        if (normalized.includes(common)) {
            return { valid: false, error: 'Password is too common' }
        }
    }
    return { valid: true }
}
