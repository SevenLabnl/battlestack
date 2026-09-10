# syntax=docker/dockerfile:1

# Build stage

FROM node:24-alpine AS build
WORKDIR /app

ARG BUILD_NUMBER=dev
ENV BUILD_NUMBER=${BUILD_NUMBER}

# pnpm-workspace.yaml carries the `allowBuilds:` approvals for native deps and MUST land before install,
# or pnpm blocks those build scripts (ERR_PNPM_IGNORED_BUILDS). Globbed so non-pnpm managers don't break the COPY.
COPY package.json __LOCKFILE__ pnpm-workspace.yaml* .npmrc* ./

# Via npm, not corepack: Node 25+ no longer bundles corepack, so this survives the base image moving past 24.
__PM_BOOTSTRAP__

__INSTALL_BLOCK__

COPY . ./

# Must exist even for a `db:push` project with no generated SQL, because the runtime COPY below depends on it.
RUN mkdir -p /app/server/database/migrations

# nuxt-security's rateLimiter is baked in at build time, so it cannot be toggled at container runtime; empty means ON.
# NEVER build a production image with `--build-arg NUXT_RATE_LIMIT_DISABLED=true`: it removes the per-IP rate limit.
ARG NUXT_RATE_LIMIT_DISABLED=""
ENV NUXT_RATE_LIMIT_DISABLED=${NUXT_RATE_LIMIT_DISABLED}

# 4GB heap: Nitro's server bundling of Mastra plus Tailwind v4 blows past the default ~2GB ceiling.
# Set inline so intermediate shells and package-manager exec wrappers cannot drop it.
RUN NODE_OPTIONS="--max-old-space-size=4096" __PM__ run build

__BUNDLE_TOOLS_BLOCK__

# Nitro's tracer copies an npm-aliased dep under its real name, so the alias name it was imported
# by is absent from `.output`. Copy every `npm:` alias in package.json into the server output.
RUN node -e 'const fs=require("fs"),p=require("path");const deps=JSON.parse(fs.readFileSync("package.json","utf8")).dependencies||{};for(const[alias,spec]of Object.entries(deps)){if(!spec.startsWith("npm:"))continue;const src=p.join("node_modules",alias);if(!fs.existsSync(src))continue;const dest=p.join(".output/server/node_modules",alias);fs.mkdirSync(p.dirname(dest),{recursive:true});fs.cpSync(src,dest,{recursive:true,dereference:true});console.log("aliased dep -> "+alias)}'

# Fail the build when the output imports an alias the copy step did not provide, instead of
# shipping an image that dies at boot with ERR_MODULE_NOT_FOUND.
RUN node <<'GUARD'
const fs = require('node:fs')
const path = require('node:path')

const OUT = '.output/server'
const code = []
const manifests = []

;(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name === 'package.json') manifests.push(full)
        else if (/\.(mjs|cjs|js)$/.test(entry.name)) code.push(full)
    }
})(OUT)

// Only names some package declares as an `npm:` alias can hit the tracer's rename.
const aliases = new Set()
for (const manifest of manifests) {
    let deps
    try {
        deps = JSON.parse(fs.readFileSync(manifest, 'utf8')).dependencies
    } catch {
        continue
    }
    for (const [name, spec] of Object.entries(deps ?? {})) {
        if (typeof spec === 'string' && spec.startsWith('npm:')) aliases.add(name)
    }
}

// Bounded at OUT: /app/node_modules holds the aliases the copy step reads from, so a walk that
// escaped the output would report every alias as present.
function present(alias, from) {
    const stop = path.resolve(OUT)
    let dir = path.resolve(from)
    for (;;) {
        if (fs.existsSync(path.join(dir, 'node_modules', alias))) return true
        if (dir === stop) return false
        const up = path.dirname(dir)
        if (up === dir) return false
        dir = up
    }
}

const patterns = [...aliases].map((alias) => ({
    alias,
    re: new RegExp('(?:from|import|require)\\s*\\(?\\s*["\']' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']'),
}))

const missing = new Map()
for (const file of code) {
    const source = fs.readFileSync(file, 'utf8')
    for (const { alias, re } of patterns) {
        if (!re.test(source) || present(alias, path.dirname(file))) continue
        if (!missing.has(alias)) missing.set(alias, path.relative(OUT, file))
    }
}

if (missing.size > 0) {
    console.error('Imported by .output under an alias name that is not in the output:')
    for (const [alias, file] of missing) console.error(`  ${alias}  (imported by ${file})`)
    console.error('Add it to `dependencies` in package.json as `<alias>@npm:<real-package>@<range>`.')
    process.exit(1)
}
console.log(`alias guard: ${aliases.size} aliased packages, all resolvable`)
GUARD

# Runtime stage

FROM node:24-alpine AS runtime
WORKDIR /app

COPY --from=build --chown=node:node /app/.output/ ./

__COPY_TOOLS_BLOCK__

ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

USER node

CMD ["node", "/app/server/index.mjs"]
