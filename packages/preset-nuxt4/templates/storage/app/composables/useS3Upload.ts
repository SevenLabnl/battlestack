export interface UploadedFile {
    key: string
    size: number
    mime: string | null
}

export function useS3Upload() {
    const uploading = ref(false)
    const progress = ref(0)
    const error = ref<string | null>(null)

    async function upload(file: File): Promise<UploadedFile> {
        uploading.value = true
        progress.value = 0
        error.value = null
        try {
            const form = new FormData()
            form.append('file', file)
            return await new Promise<UploadedFile>((resolve, reject) => {
                const xhr = new XMLHttpRequest()
                xhr.open('POST', '/api/files/upload-url', true)
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) progress.value = Math.round((e.loaded / e.total) * 100)
                }
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            resolve(JSON.parse(xhr.responseText))
                        } catch {
                            reject(new Error('Invalid server response'))
                        }
                    } else {
                        reject(new Error(`Upload failed: ${xhr.status}`))
                    }
                }
                xhr.onerror = () => reject(new Error('Upload network error'))
                xhr.send(form)
            })
        } catch (e: unknown) {
            error.value = (e as Error)?.message ?? 'Upload failed'
            throw e
        } finally {
            uploading.value = false
        }
    }

    return { upload, uploading, progress, error }
}
