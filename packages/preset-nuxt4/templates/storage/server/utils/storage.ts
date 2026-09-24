import {
    S3Client,
    DeleteObjectCommand,
    HeadObjectCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { createError } from 'h3'

let client: S3Client | null = null

/**
 * Path-style addressing unless the endpoint can serve `<bucket>.<host>`: localhost, an IP or a
 * single-label service name (`http://rustfs:9000`) cannot. `NUXT_S3_FORCE_PATH_STYLE` overrides.
 */
export function usePathStyle(endpoint: string, override?: unknown): boolean {
    const forced = String(override ?? '').trim().toLowerCase()
    if (forced === 'true') return true
    if (forced === 'false') return false
    let host: string
    try {
        host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '')
    } catch {
        return false
    }
    return !host.includes('.') || isIP(host) !== 0
}

export function getClient(): S3Client {
    if (client) return client
    const cfg = useRuntimeConfig()
    if (!cfg.s3Endpoint || !cfg.s3AccessKeyId || !cfg.s3SecretAccessKey) {
        throw createError({ statusCode: 500, statusMessage: 'Object storage not configured' })
    }
    const endpoint = String(cfg.s3Endpoint)
    client = new S3Client({
        region: String(cfg.s3Region) || 'us-east-1',
        endpoint,
        forcePathStyle: usePathStyle(endpoint, cfg.s3ForcePathStyle),
        credentials: {
            accessKeyId: String(cfg.s3AccessKeyId),
            secretAccessKey: String(cfg.s3SecretAccessKey),
        },
    })
    return client
}

export function bucket(): string {
    const cfg = useRuntimeConfig()
    if (!cfg.s3Bucket) {
        throw createError({ statusCode: 500, statusMessage: 'S3 bucket not configured' })
    }
    return cfg.s3Bucket
}

/** Build a random opaque object key, optionally with a sanitised extension. */
export function newObjectKey(prefix = 'uploads', ext?: string): string {
    const id = randomBytes(16).toString('hex')
    const safeExt = ext && /^[a-zA-Z0-9]{1,8}$/.test(ext) ? `.${ext.toLowerCase()}` : ''
    return `${prefix}/${new Date().toISOString().slice(0, 10)}/${id}${safeExt}`
}

/**
 * Time-limited SIGNED URL: works for private objects, expires. Default for
 * downloads. Safe to hand to an LLM/agent for a one-off fetch within the TTL.
 */
export async function createDownloadUrl(key: string, expiresIn = 60 * 5): Promise<string> {
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
        expiresIn,
    })
}

/**
 * Stable PUBLIC URL: no signature, no expiry, only resolves if the object/bucket is actually public. Prefer
 * `NUXT_S3_PUBLIC_BASE_URL` (CDN/public domain); otherwise derive `<endpoint>/<bucket>/<key>` (path-style).
 */
export function createPublicUrl(key: string, bucketName: string = bucket()): string {
    const cfg = useRuntimeConfig()
    const base = String(cfg.s3PublicBaseUrl ?? '').replace(/\/+$/, '')
    if (base) return `${base}/${key}`
    const endpoint = String(cfg.s3Endpoint ?? '').replace(/\/+$/, '')
    return `${endpoint}/${bucketName}/${key}`
}

export async function deleteObject(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
}

export async function headObject(key: string) {
    return getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
}
