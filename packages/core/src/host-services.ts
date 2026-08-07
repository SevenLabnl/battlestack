import type { RunContext } from './types/run-context.js'
import type { PackageManager } from './types/package-manager.js'

/** Injectable seam for host-side (CLI) services a feature's project command needs. */
export interface HostServices {
    /** Bootstrap a project checkout: write `.env`, install deps (and optionally the DB). */
    bootstrapProject?(ctx: RunContext, pm: PackageManager, opts?: { includeDb?: boolean }): Promise<void>
    /** Bring the Traefik dev-gateway up (idempotent). */
    gatewayUp?(): Promise<void>
    /** Register a project's dev-server route with the gateway. */
    registerProject?(projectName: string, hostname: string, port: number): Promise<void>
}

let current: HostServices = {}

/** Install real CLI-backed implementations. Called once at CLI startup. */
export function setHostServices(services: HostServices): void {
    current = services
}

/** The currently-installed host services; empty object (all members optional) by default. */
export function getHostServices(): HostServices {
    return current
}
