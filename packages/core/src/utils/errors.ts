export enum ErrorCode {
    INVALID_PROJECT_NAME = 'INVALID_PROJECT_NAME',
    DIRECTORY_EXISTS = 'DIRECTORY_EXISTS',
    UNKNOWN_FRAMEWORK = 'UNKNOWN_FRAMEWORK',
    UNKNOWN_TEMPLATE = 'UNKNOWN_TEMPLATE',
    UNKNOWN_FEATURE = 'UNKNOWN_FEATURE',
    UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',
    EXEC_FAILED = 'EXEC_FAILED',
    SCAFFOLD_FAILED = 'SCAFFOLD_FAILED',
    USER_ABORTED = 'USER_ABORTED',
    PORT_IN_USE = 'PORT_IN_USE',
    DOCKER_FAILED = 'DOCKER_FAILED',
}

const RECOVERY_HINTS: Partial<Record<ErrorCode, string>> = {
    [ErrorCode.DIRECTORY_EXISTS]: 'Pick a different project name or remove the existing directory.',
    [ErrorCode.UNSUPPORTED_FEATURE]:
        'This feature is not supported by the chosen framework. Pick a different framework or template.',
    [ErrorCode.EXEC_FAILED]: 'Re-run with --debug to see the full command output.',
    [ErrorCode.PORT_IN_USE]:
        'The app is likely already running in another terminal. Stop that session, '
        + 'or find the process with `lsof -i tcp:<port>` and kill it.',
    [ErrorCode.DOCKER_FAILED]:
        'Check the output above. Common causes: (1) Docker Desktop isn\'t running, so start it; '
        + '(2) "error getting credentials" → your Docker credential helper is broken: edit '
        + '~/.docker/config.json and remove/fix the `credsStore` line (or reinstall the helper, '
        + 'e.g. docker-credential-desktop), then retry.',
}

export class CLIError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly cause?: unknown,
    ) {
        super(message)
        this.name = 'CLIError'
    }

    getUserMessage(): string {
        return `${this.code}: ${this.message}`
    }

    getRecoveryHint(): string | undefined {
        return RECOVERY_HINTS[this.code]
    }
}

export function wrapError(error: unknown, code: ErrorCode): CLIError {
    if (error instanceof CLIError) return error
    const message = error instanceof Error ? error.message : String(error)
    return new CLIError(code, message, error)
}
