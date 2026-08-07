import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3'

/** Cold-boot bucket bootstrap: create the bucket if it doesn't exist. Idempotent. */
export default defineNitroPlugin(async () => {
    const cfg = useRuntimeConfig()
    const endpoint = String(cfg.s3Endpoint ?? '')
    const bucketName = String(cfg.s3Bucket ?? '')
    const accessKeyId = String(cfg.s3AccessKeyId ?? '')
    const secretAccessKey = String(cfg.s3SecretAccessKey ?? '')

    if (!endpoint || !bucketName || !accessKeyId || !secretAccessKey) return

    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(endpoint)
    const client = new S3Client({
        region: String(cfg.s3Region ?? 'us-east-1'),
        endpoint,
        forcePathStyle: isLocal,
        credentials: { accessKeyId, secretAccessKey },
    })

    try {
        await client.send(new HeadBucketCommand({ Bucket: bucketName }))
    } catch {
        try {
            await client.send(new CreateBucketCommand({ Bucket: bucketName }))
        } catch {
            // bucket may already exist, or the account lacks CreateBucket; both are fine
        }
    }
})
