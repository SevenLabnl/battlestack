import { run } from './run.js'

export async function hasMkcert(): Promise<boolean> {
    try {
        await run('mkcert', ['-version'], { inherit: false })
        return true
    } catch {
        return false
    }
}

export async function installLocalCa(): Promise<void> {
    await run('mkcert', ['-install'], { inherit: true })
}

export async function issueWildcardCert(
    outDir: string,
    baseDomain: string,
): Promise<{ cert: string, key: string }> {
    const certName = baseDomain.replaceAll('.', '_')
    const cert = `${certName}.pem`
    const key = `${certName}-key.pem`
    await run(
        'mkcert',
        ['-cert-file', cert, '-key-file', key, `*.${baseDomain}`, baseDomain],
        { cwd: outDir, inherit: true },
    )
    return { cert, key }
}
