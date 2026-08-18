/**
 * JSON stdout discipline: every command prints exactly one JSON object.
 * Diagnostics (if any) go to stderr — never stdout.
 */

export function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

export function writeErrorJson(code: string, message: string): void {
  writeJson({ ok: false, error: { code, message } })
}
