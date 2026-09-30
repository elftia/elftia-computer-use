import { once } from 'node:events'
import { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { parseArgv, type CuaServeInvocation } from '../args.js'
import { CliError } from '../errors.js'
import { buildCuaServeServer, isLoopbackHost } from './cua-serve.js'
import type { CuaDriverSurface } from './cua.js'

function invocation(args: string[]): CuaServeInvocation {
  const parsed = parseArgv(['cua-serve', ...args])
  if (parsed.kind !== 'command' || parsed.invocation.command !== 'cua-serve') throw new Error('bad fixture')
  return parsed.invocation
}

function fakeDriver(): CuaDriverSurface {
  return {
    callTool: async (name, argumentsJson) =>
      name === 'get_window_state'
        ? { text: 'state', structuredJson: `{"echo":${JSON.stringify(argumentsJson)}}`, isError: false }
        : { text: `called ${name}`, isError: false },
    listToolsJson: async () => '{"tools":[]}',
    metadata: async () => ({ driverVersion: 'test' }),
    shutdown: async () => {
      /* nothing to clean up */
    },
  }
}

function post(server: { port: number }, token: string, path: string, body: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: path === '/health' ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: path === '/health' ? undefined : body,
  }).then(async (response) => ({ status: response.status, json: (await response.json()) as Record<string, unknown> }))
}

describe('cua-serve argument parsing', () => {
  it('defaults host and port', () => {
    expect(invocation([])).toEqual({ command: 'cua-serve', host: '127.0.0.1', port: 0 })
  })

  it('rejects non-loopback hosts and bad ports', () => {
    expect(() => invocation(['--host', '0.0.0.0'])).toThrow(CliError)
    expect(() => invocation(['--port', '99999'])).toThrow(CliError)
  })

  it('accepts all loopback spellings', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('192.168.1.5')).toBe(false)
  })
})

describe('cua-serve HTTP surface', () => {
  it('authenticates, calls tools with the serve session and shuts down', async () => {
    let shutdownSeen = false
    const server = buildCuaServeServer(fakeDriver(), 'sekrit', () => {
      shutdownSeen = true
      server.close()
      server.closeAllConnections()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo

    const unauthenticated = await fetch(`http://127.0.0.1:${port}/health`)
    expect(unauthenticated.status).toBe(401)

    const health = await post({ port }, 'sekrit', '/health', '')
    expect(health.status).toBe(200)
    expect(health.json.ok).toBe(true)
    expect(health.json.action).toBe('health')

    const call = await post({ port }, 'sekrit', '/call', '{"action":"get_window_state","args":{"pid":1}}')
    expect(call.status).toBe(200)
    expect(call.json.ok).toBe(true)
    const structured = call.json.structured as { echo: string }
    expect(JSON.parse(structured.echo)).toEqual({ pid: 1, session: 'elftia-serve' })

    const badAction = await post({ port }, 'sekrit', '/call', '{"args":{}}')
    expect(badAction.status).toBe(400)

    const shutdown = await post({ port }, 'sekrit', '/shutdown', '{}')
    expect(shutdown.status).toBe(200)
    expect(shutdown.json).toEqual({ ok: true, action: 'shutdown' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(shutdownSeen).toBe(true)
  })
})
