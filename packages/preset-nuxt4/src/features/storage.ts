import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { emitTemplate, emitTemplateUpdate } from '../utils/emit-template.js'
import { patchNuxtConfig } from '../utils/nuxt-config.js'
import { allocatePort, STAGE, type EnvVar, type Feature } from '@battlestack/core'

/**
 * S3-compatible object storage. Uploads proxy through the app, downloads are presigned.
 * Dev uses a RustFS container; prod uses Scaleway or any S3 provider.
 */
export const storageFeature: Feature = {
    id: 'nuxt4:storage',
    version: '1.2.3',
    label: 'Object storage (RustFS dev / S3 prod)',
    description: 'File uploads and presigned downloads; RustFS locally, S3-compatible provider in prod.',
    frameworks: ['nuxt4'],
    stage: STAGE.STORAGE,
    failureIsNonFatal: true,
    requires: ['nuxt4:auth'],

    collectDeps() {
        return {
            prod: [
                '@aws-sdk/client-s3',
                '@aws-sdk/s3-request-presigner',
            ],
        }
    },

    collectDocs() {
        return [
            {
                heading: 'Storage',
                body: [
                    'S3-compatible object store. File uploads are proxied through the Nuxt server: the browser POSTs to `/api/files/upload-url`, which streams the file to S3 via `PutObjectCommand`. No CORS configuration needed.',
                    '',
                    'Dev backend: **RustFS** (`rustfs/rustfs`) shipped in the project\'s `docker-compose.yml`. `battlestack up` starts it; the built-in web console is on `http://localhost:$S3_CONSOLE_PORT` (port allocated per project).',
                    '',
                    'Prod backend: any S3-compatible provider (Scaleway by default). Set `NUXT_S3_ENDPOINT` + credentials in the prod env.',
                    '',
                    '- `POST /api/files/upload-url` accepts `multipart/form-data` with a `file` field, uploads to S3, returns `{ key, size, mime }`',
                    '- `POST /api/files` records a `files` row once the object has landed (HEAD-checked against the bucket; refuses to record an absent object)',
                    '- `GET /api/files` lists rows the caller owns (admins see all)',
                    '- `GET /api/files/:id/download-url` per-row download (owner or admin). Default returns a time-limited **signed** URL; `?mode=public` returns a stable non-expiring URL (for forwarding to an LLM/agent; only resolves if the object/bucket is public). Response includes `etag`.',
                    '- `DELETE /api/files/:id` deletes object then row (owner or admin)',
                    '- `useS3Upload()` composable + `<FileUpload />` component handle the browser side',
                    '',
                    'MIME allowlist lives in `upload-url.post.ts`. Adding a type there is the explicit signoff that it can land in your bucket.',
                    '',
                    'Despite the route name, `/api/files/upload-url` does not return a presigned URL. Unlike downloads, uploads are not presigned: the route reads the entire multipart body into memory (up to the size cap above) and proxies it to S3 itself via `PutObjectCommand`. `getSignedUrl` is used only for downloads. Two consequences of that:',
                    '',
                    '- **A reverse proxy in front of the app must allow a request body at least as large as the upload cap**, or uploads fail before this route ever sees them. Most proxies default well below that. ingress-nginx (a common Kubernetes ingress controller) defaults `client_max_body_size` to 1 MB; raise it with the `nginx.ingress.kubernetes.io/proxy-body-size` ingress annotation. A single container behind a plain nginx or Caddy front end needs the equivalent body-size directive raised the same way.',
                    '- **Memory cost is roughly `max upload size × concurrent uploads`, per app instance.** Every upload holds its full buffer in that instance\'s memory for the duration of the request. Size container memory limits (and any horizontal scaling) with that in mind. A presigned-upload rewrite (the browser uploads straight to the bucket, the app never buffers the bytes) is queued as a v0.1.x follow-up; until then this is the real cost model, not a corner case.',
                ].join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    collectEnv(ctx): EnvVar[] {
        const region = String(ctx.state.storageRegion ?? 'nl-ams')
        const s3ApiPort = allocatePort(ctx.projectName, 's3-api')
        const s3ConsolePort = allocatePort(ctx.projectName, 's3-console')
        return [
            {
                key: 'NUXT_S3_REGION',
                value: 'us-east-1',
                example: region,
                group: 'Storage',
                description: `Dev uses 'us-east-1' for RustFS. Prod: Scaleway region (e.g. ${region}).`,
            },
            {
                key: 'NUXT_S3_ENDPOINT',
                value: `http://localhost:${s3ApiPort}`,
                example: `https://s3.${region}.scw.cloud`,
                group: 'Storage',
                description: 'Dev points at local RustFS. Prod: Scaleway / S3-compatible endpoint.',
            },
            {
                key: 'NUXT_S3_BUCKET',
                value: ctx.projectName,
                example: 'my-bucket',
                group: 'Storage',
            },
            {
                key: 'NUXT_S3_PUBLIC_BASE_URL',
                value: '',
                example: 'https://cdn.example.com',
                group: 'Storage',
                description:
                    'Optional. Base URL for PUBLIC download links (e.g. a CDN or public bucket domain). When set, `?mode=public` download URLs become `<base>/<key>`. Leave blank to derive `<endpoint>/<bucket>/<key>`. Only meaningful if the object/bucket is actually public.',
            },
            {
                key: 'NUXT_S3_ACCESS_KEY_ID',
                value: 'rustfsadmin',
                example: 'replace-me',
                group: 'Storage',
                secret: true,
                description: 'Dev: RustFS access key (default `rustfsadmin`). Prod: real access key.',
            },
            {
                key: 'NUXT_S3_SECRET_ACCESS_KEY',
                value: 'rustfsadmin',
                example: 'replace-me',
                group: 'Storage',
                secret: true,
                description: 'Dev: RustFS secret key. Prod: real secret.',
            },
            {
                key: 'S3_API_PORT',
                value: String(s3ApiPort),
                example: '9000',
                group: 'Storage',
                description: 'Dev-only: host port mapped to the RustFS S3 API container. Per-project to avoid collisions. Irrelevant in prod (managed S3).',
            },
            {
                key: 'S3_CONSOLE_PORT',
                value: String(s3ConsolePort),
                example: '9001',
                group: 'Storage',
                description: 'Dev-only: host port for the RustFS web console. Irrelevant in prod.',
            },
        ]
    },

    async execute(ctx) {
        await emitTemplate(ctx, 'nuxt4:storage', import.meta.url, 'storage')
        await addRuntimeConfig(ctx.projectDir)
        await patchUsersSchema(ctx.projectDir)
    },

    async update(ctx, prev) {
        const result = await emitTemplateUpdate(ctx, 'nuxt4:storage', import.meta.url, 'storage', prev)
        await addRuntimeConfig(ctx.projectDir)
        await patchUsersSchema(ctx.projectDir)
        return result
    },
}

async function addRuntimeConfig(projectDir: string): Promise<void> {
    await patchNuxtConfig(projectDir, (c) =>
        c.mergeRuntimeConfig({
            s3Region: '',
            s3Endpoint: '',
            s3Bucket: '',
            s3AccessKeyId: '',
            s3SecretAccessKey: '',
            s3PublicBaseUrl: '',
        }),
    )
}

async function patchUsersSchema(projectDir: string): Promise<void> {
    const schemaPath = path.join(projectDir, 'server/database/schema/users.ts')
    let content: string
    try {
        content = await readFile(schemaPath, 'utf8')
    } catch {
        return // file not yet present, skip
    }
    if (content.includes('avatarKey')) return
    const patched = content.replace(
        /locale: text\('locale'\)\.notNull\(\)\.default\('nl'\),/,
        'locale: text(\'locale\').notNull().default(\'nl\'),\n    avatarKey: text(\'avatar_key\'),',
    )
    if (patched === content) return // anchor not found, skip
    await writeFile(schemaPath, patched, 'utf8')
}
