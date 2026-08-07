export type EmailLocale = 'en' | 'nl'
export type EmailPurpose = 'reset-password' | 'verify-email' | 'account-exists'

interface EmailContent {
    subject: string
    html: string
    text: string
}

interface TemplateInput {
    link: string
    ttlLabel: string
}

const TEMPLATES: Record<EmailPurpose, Record<EmailLocale, (i: TemplateInput) => EmailContent>> = {
    'reset-password': {
        en: ({ link, ttlLabel }) => ({
            subject: 'Reset your password',
            html: `<p>Click to reset your password (valid for ${ttlLabel}):</p><p><a href="${link}">${link}</a></p><p>If you did not request this, ignore this email.</p>`,
            text: `Reset your password: ${link}\nValid for ${ttlLabel}. If you did not request this, ignore this email.`,
        }),
        nl: ({ link, ttlLabel }) => ({
            subject: 'Wachtwoord opnieuw instellen',
            html: `<p>Klik om je wachtwoord opnieuw in te stellen (geldig voor ${ttlLabel}):</p><p><a href="${link}">${link}</a></p><p>Heb je dit niet aangevraagd, negeer dan deze e-mail.</p>`,
            text: `Wachtwoord opnieuw instellen: ${link}\nGeldig voor ${ttlLabel}. Heb je dit niet aangevraagd, negeer dan deze e-mail.`,
        }),
    },
    'verify-email': {
        en: ({ link, ttlLabel }) => ({
            subject: 'Verify your email',
            html: `<p>Verify your email (valid for ${ttlLabel}):</p><p><a href="${link}">${link}</a></p>`,
            text: `Verify your email: ${link}\nValid for ${ttlLabel}.`,
        }),
        nl: ({ link, ttlLabel }) => ({
            subject: 'Bevestig je e-mailadres',
            html: `<p>Bevestig je e-mailadres (geldig voor ${ttlLabel}):</p><p><a href="${link}">${link}</a></p>`,
            text: `Bevestig je e-mailadres: ${link}\nGeldig voor ${ttlLabel}.`,
        }),
    },
    // Anti-enumeration: signup answers identically for new and existing emails, so the real owner is told out-of-band instead. No TTL.
    'account-exists': {
        en: ({ link }) => ({
            subject: 'You already have an account',
            html: `<p>Someone tried to sign up with this email, but you already have an account.</p><p><a href="${link}">Sign in</a>, or reset your password if you've forgotten it. If this wasn't you, you can safely ignore this email.</p>`,
            text: `Someone tried to sign up with this email, but you already have an account.\nSign in: ${link}\nIf this wasn't you, ignore this email.`,
        }),
        nl: ({ link }) => ({
            subject: 'Je hebt al een account',
            html: `<p>Iemand probeerde zich aan te melden met dit e-mailadres, maar je hebt al een account.</p><p><a href="${link}">Inloggen</a>, of stel je wachtwoord opnieuw in als je het bent vergeten. Was jij dit niet, dan kun je deze e-mail negeren.</p>`,
            text: `Iemand probeerde zich aan te melden met dit e-mailadres, maar je hebt al een account.\nInloggen: ${link}\nWas jij dit niet, negeer deze e-mail.`,
        }),
    },
}

const TTL_LABELS: Record<EmailLocale, { hour1: string; hour24: string }> = {
    en: { hour1: '1 hour', hour24: '24 hours' },
    nl: { hour1: '1 uur', hour24: '24 uur' },
}

function pickLocale(input: string | null | undefined): EmailLocale {
    if (input === 'nl' || input === 'en') return input
    return 'en'
}

export function emailContent(
    purpose: EmailPurpose,
    locale: string | null | undefined,
    input: { link: string; ttlMs: number },
): EmailContent {
    const loc = pickLocale(locale)
    const labels = TTL_LABELS[loc]
    const ttlLabel = input.ttlMs >= 12 * 60 * 60 * 1000 ? labels.hour24 : labels.hour1
    return TEMPLATES[purpose][loc]({ link: input.link, ttlLabel })
}
