import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PLUGIN_NAME_RE, spawnSyncResolved } from '@battlestack/core'

/** A minimal npm project owned by the CLI at `<battlestackHome>/plugins`. Uses the user's npm auth. */

interface StorePkg {
    name: string
    private: true
    dependencies: Record<string, string>
}

async function readStore(battlestackHome: string): Promise<{ dir: string; pkg: StorePkg }> {
    const dir = path.join(battlestackHome, 'plugins')
    const file = path.join(dir, 'package.json')
    let pkg: StorePkg = { name: 'battlestack-plugin-store', private: true, dependencies: {} }
    if (existsSync(file)) pkg = JSON.parse(await readFile(file, 'utf8'))
    return { dir, pkg }
}

async function writeStore(dir: string, pkg: StorePkg): Promise<void> {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 4) + '\n')
}

/** Rejects a name `discoverPlugins` would never load. */
function assertValidPluginName(name: string): void {
    if (PLUGIN_NAME_RE.test(name)) return
    throw new Error(
        `"${name}" isn't a valid battlestack plugin name, so it won't be loaded. Expected `
        + '"battlestack-plugin*" or "battlestack-preset*" (optionally scoped, e.g. '
        + `"@scope/battlestack-plugin-foo"). Rename the package (its package.json#name) and try again.`,
    )
}

export async function pluginAdd(battlestackHome: string, spec: string): Promise<void> {
    const { dir, pkg } = await readStore(battlestackHome)
    if (existsSync(spec) || spec.startsWith('.') || path.isAbsolute(spec)) {
        // Local checkout: link by path.
        const abs = path.resolve(spec)
        const name = JSON.parse(await readFile(path.join(abs, 'package.json'), 'utf8')).name
        assertValidPluginName(name)
        pkg.dependencies[name] = `file:${abs}`
        await writeStore(dir, pkg)
        console.log(`Linked ${name} -> ${abs}`)
        return
    }
    assertValidPluginName(spec)
    pkg.dependencies[spec] = '*'
    await writeStore(dir, pkg)
    const result = spawnSyncResolved('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: dir,
        stdio: 'inherit',
    })
    if (result.status !== 0) {
        throw new Error(`npm install failed (exit ${result.status ?? result.signal ?? 'unknown'})`)
    }
    console.log(`Installed ${spec}`)
}

export async function pluginRemove(battlestackHome: string, spec: string): Promise<void> {
    const { dir, pkg } = await readStore(battlestackHome)
    if (!(spec in pkg.dependencies)) {
        console.error(`${spec} is not installed`)
        return
    }
    delete pkg.dependencies[spec]
    await writeStore(dir, pkg)
    console.log(`Removed ${spec}`)
}

export async function pluginList(battlestackHome: string): Promise<void> {
    const { pkg } = await readStore(battlestackHome)
    const entries = Object.entries(pkg.dependencies)
    if (entries.length === 0) {
        console.log('No plugins installed. Try: battlestack plugin add <package>')
        return
    }
    for (const [name, version] of entries) console.log(`  ${name}  ${version}`)
}
