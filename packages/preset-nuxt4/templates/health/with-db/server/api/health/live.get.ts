/**
 * Liveness: is this process able to serve a request? Checks nothing else — a failing
 * liveness probe restarts the pod, and a restart cannot fix a bad dependency.
 * Dependency checks belong in `/api/health/ready`.
 */
export default defineEventHandler(() => ({ status: 'ok' as const }))
