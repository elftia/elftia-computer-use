import type { CliError } from '../errors.js'
import type { ShellRunner } from '../platform/shell-runner.js'

export interface ScriptCall {
  scriptName: string
  args: string[]
}

/**
 * In-memory ShellRunner: records every script invocation and returns
 * configured JSON responses or throws configured errors.
 */
export class FakeShellRunner implements ShellRunner {
  readonly calls: ScriptCall[] = []
  readonly responses = new Map<string, (call: ScriptCall) => Record<string, unknown>>()
  readonly failures = new Map<string, (call: ScriptCall) => CliError | Error>()

  private defaultResponse(_call: ScriptCall): Record<string, unknown> {
    return { ok: true }
  }

  async run(
    scriptName: string,
    args: ReadonlyArray<string | number>,
    _opts?: { timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const call: ScriptCall = { scriptName, args: args.map(String) }
    this.calls.push(call)
    const failure = this.failures.get(scriptName)
    if (failure !== undefined) {
      throw failure(call)
    }
    const respond = this.responses.get(scriptName) ?? this.defaultResponse
    return respond(call)
  }

  async probe(): Promise<{ version: string; elevated: boolean; latencyMs: number }> {
    return { version: '5.1.26100.8875', elevated: false, latencyMs: 100 }
  }
}
