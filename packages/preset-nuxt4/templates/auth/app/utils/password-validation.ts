import { z } from 'zod'
import {
    checkPasswordPolicy,
    isPasswordPolicyCode,
    PASSWORD_MIN_LENGTH,
} from '#shared/utils/password-policy'
import type { PasswordPolicyCode } from '#shared/utils/password-policy'

type Translate = (key: string, named: Record<string, unknown>) => string

/** Signup and user-admin share the `auth.signup.validation` messages. */
export function passwordPolicyMessage(t: Translate, code: PasswordPolicyCode): string {
    return t(`auth.signup.validation.${code}`, { min: PASSWORD_MIN_LENGTH })
}

/** `allowEmpty` lets an edit form leave the stored password unchanged. */
export function passwordPolicySchema(t: Translate, { allowEmpty = false } = {}) {
    return z.string().superRefine((password, ctx) => {
        if (allowEmpty && password === '') return
        const policy = checkPasswordPolicy(password)
        if (!policy.valid) {
            ctx.addIssue({ code: 'custom', message: passwordPolicyMessage(t, policy.code) })
        }
    })
}

/** Translates the rule an API handler reports as `data.passwordPolicy`, instead of its English statusMessage. */
export function passwordPolicyServerMessage(e: unknown, t: Translate): string | undefined {
    const code = (e as { data?: { data?: { passwordPolicy?: unknown } } }).data?.data?.passwordPolicy
    return isPasswordPolicyCode(code) ? passwordPolicyMessage(t, code) : undefined
}
