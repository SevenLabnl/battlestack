import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface SendEmailOptions {
    to: string
    subject: string
    html: string
    text?: string
}

let transporter: Transporter | null = null

function getTransporter(): Transporter {
    if (!transporter) {
        const config = useRuntimeConfig()
        const port = Number(config.smtpPort)
        if (!port) {
            throw new Error(
                'NUXT_SMTP_PORT not set. Mailpit port is per-project; check .env or run `battlestack describe` for the allocated port.',
            )
        }
        const isProd = !import.meta.dev
        // TLS enforced in production unless `NUXT_SMTP_REQUIRE_TLS=false`, needed for catchers like Mailpit that advertise STARTTLS then 502 on it.
        // Its registered default is an empty string, not `false`, so "never set" stays distinguishable from "explicitly disabled" and falls back to `isProd`.
        const requireTls = typeof config.smtpRequireTls === 'boolean' ? config.smtpRequireTls : isProd
        const username = String(config.smtpUsername ?? '')
        const password = String(config.smtpPassword ?? '')
        transporter = nodemailer.createTransport({
            host: String(config.smtpHost ?? 'localhost'),
            port,
            secure: port === 465,
            requireTLS: requireTls,
            // Also suppress nodemailer's opportunistic STARTTLS: Mailpit advertises it in EHLO but 502s when it is used.
            ignoreTLS: !requireTls,
            auth: username || password ? { user: username, pass: password } : undefined,
            tls: requireTls ? { minVersion: 'TLSv1.2' } : undefined,
        })
    }
    return transporter
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
    const config = useRuntimeConfig()
    await getTransporter().sendMail({
        from: String(config.smtpFrom),
        to: options.to,
        subject: options.subject,
        html: options.html,
        ...(options.text && { text: options.text }),
    })
}
