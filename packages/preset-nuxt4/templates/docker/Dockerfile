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

# Nitro's file tracer cannot copy npm-aliased deps under their alias names, which Mastra's `@mastra/schema-compat` imports.
# Copy them into the server output under the aliased path so runtime resolution works without inline-bundling.
RUN if [ -d node_modules/zod-from-json-schema-v3 ]; then \
        mkdir -p .output/server/node_modules && \
        cp -RL node_modules/zod-from-json-schema-v3 .output/server/node_modules/; \
    fi && \
    if [ -d node_modules/@ai-sdk/provider-utils-v5 ]; then \
        mkdir -p .output/server/node_modules/@ai-sdk && \
        cp -RL node_modules/@ai-sdk/provider-utils-v5 .output/server/node_modules/@ai-sdk/; \
    fi

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
