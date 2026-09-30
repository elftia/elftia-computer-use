import { describe, expect, it } from 'vitest'
import { parseArgv, type CuaInvocation } from '../args.js'
import { CliError } from '../errors.js'
import { callCuaTool, runCua, type CuaDriverSurface } from './cua.js'
import { createDefaultDeps } from './deps.js'

function invocation(args: string[]): CuaInvocation {
  const parsed = parseArgv(['cua', ...args])
  if (parsed.kind !== 'command' || parsed.invocation.command !== 'cua') throw new Error('bad fixture')
  return parsed.invocation
}

function fakeDriver(overrides: Partial<Record<keyof CuaDriverSurface, unknown>> = {}): CuaDriverSurface {
  const calls: { name: string; argumentsJson: string }[] = []
  const driver: CuaDriverSurface & { calls: typeof calls } = {
    calls,
    callTool: async (name, argumentsJson) => {
      calls.push({ name, argumentsJson })
      if (overrides.callTool) return (overrides.callTool as (name: string, args: string) => unknown)(name, argumentsJson)
      return { text: 'ok', structuredJson: '{"windows":[]}', isError: false }
    },
    listToolsJson: async () =>
      typeof overrides.listToolsJson === 'string' ? (overrides.listToolsJson as string) : '{"tools":[{"name":"click"}]}',
    metadata: async () =>
      overrides.metadata ?? { driverVersion: '0.30.4', contractVersion: '0.8.0' },
    shutdown: async () => {
      /* recorded below via flag */
    },
  }
  return driver
}

describe('cua argument parsing', () => {
  it('defaults the session label and accepts tool args', () => {
    const parsed = invocation(['--action', 'click', '--args', '{"element_token":"s1:0"}'])
    expect(parsed).toEqual({
      command: 'cua',
      action: 'click',
      args: '{"element_token":"s1:0"}',
      session: 'elftia',
    })
  })

  it('rejects non-object args, bad sessions and missing actions', () => {
    expect(() => invocation(['--action', 'click', '--args', '[1]'])).toThrow(CliError)
    expect(() => invocation(['--action', 'click', '--args', 'nope'])).toThrow(CliError)
    expect(() => invocation(['--action', 'click', '--session', 'bad session!'])).toThrow(CliError)
    expect(() => invocation([])).toThrow(CliError)
  })
})

describe('callCuaTool passthrough', () => {
  it('merges the default session into args and parses the structured payload', async () => {
    const driver = fakeDriver()
    const payload = await callCuaTool(driver, 'get_window_state', '{"pid":1}', 'elftia')
    const sent = JSON.parse((driver as unknown as { calls: { argumentsJson: string }[] }).calls[0].argumentsJson)
    expect(sent).toEqual({ pid: 1, session: 'elftia' })
    expect(payload).toEqual({ ok: true, action: 'get_window_state', text: 'ok', structured: { windows: [] } })
  })

  it('keeps an explicit session label from args', async () => {
    const driver = fakeDriver()
    await callCuaTool(driver, 'click', '{"session":"explicit"}', 'elftia')
    const sent = JSON.parse((driver as unknown as { calls: { argumentsJson: string }[] }).calls[0].argumentsJson)
    expect(sent.session).toBe('explicit')
  })

  it('maps tool errors to ok:false with the SDK error code', async () => {
    const driver = fakeDriver({ callTool: () => ({ text: 'busy', isError: true, errorCode: 'background_unavailable' }) })
    const payload = await callCuaTool(driver, 'click', undefined, 'elftia')
    expect(payload).toEqual({ ok: false, action: 'click', errorCode: 'background_unavailable', text: 'busy' })
  })

  it('rejects malformed args json with EUSAGE', async () => {
    const driver = fakeDriver()
    await expect(callCuaTool(driver, 'click', 'not json', 'elftia')).rejects.toThrow(CliError)
  })
})

describe('runCua health and list-tools', () => {
  it('reports driver version and tool count', async () => {
    const driver = fakeDriver()
    const payload = await runCua(invocation(['--action', 'health']), createDefaultDeps(), async () => driver)
    expect(payload).toEqual({
      ok: true,
      action: 'health',
      driverVersion: '0.30.4',
      contractVersion: '0.8.0',
      toolCount: 1,
      native: true,
    })
  })

  it('passes the tools list through', async () => {
    const driver = fakeDriver()
    const payload = await runCua(invocation(['--action', 'list-tools']), createDefaultDeps(), async () => driver)
    expect(payload).toEqual({ ok: true, action: 'list-tools', tools: { tools: [{ name: 'click' }] } })
  })
})
