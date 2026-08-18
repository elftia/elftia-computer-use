/**
 * Error taxonomy (design D9): every failure becomes one JSON error object on
 * stdout and a non-zero exit.
 *
 * EUSAGE        bad arguments (unknown command/flag, failed validation)
 * ENOTSUPPORTED the current platform has no implementation (macOS/Linux stubs)
 * EBACKEND      PowerShell spawn failure or unparseable backend output
 * EINPUT        a native operation rejected the request (SendInput failure etc.)
 * ESTALE        a state file's window no longer matches the live desktop
 * EIO           output directory / artifact write failure
 */
export type ErrorCode = 'EUSAGE' | 'ENOTSUPPORTED' | 'EBACKEND' | 'EINPUT' | 'ESTALE' | 'EIO'

export const ERROR_CODES: readonly ErrorCode[] = [
  'EUSAGE',
  'ENOTSUPPORTED',
  'EBACKEND',
  'EINPUT',
  'ESTALE',
  'EIO',
]

export class CliError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

export function usageError(message: string): CliError {
  return new CliError('EUSAGE', message)
}

export function toCliError(err: unknown, fallbackCode: ErrorCode = 'EBACKEND'): CliError {
  if (err instanceof CliError) {
    return err
  }
  const message = err instanceof Error ? err.message : String(err)
  return new CliError(fallbackCode, message)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
