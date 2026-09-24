import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArgv, type MadoInvocation } from '../args.js'
import { CliError } from '../errors.js'
import { createDefaultDeps } from './deps.js'
import { runMado, type MadoEnvironment } from './mado.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function invocation(args: string[]): MadoInvocation {
  const parsed = parseArgv(['mado', ...args])
  if (parsed.kind !== 'command' || parsed.invocation.command !== 'mado') throw new Error('bad fixture')
  return parsed.invocation
}

function fakeEnvironment(script: string): MadoEnvironment {
  return {
    platform: 'win32',
    env: { ELFTIA_MADO_PILOT_SIDECAR: process.execPath },
    spawnProcess: (_command, _args, options) => spawn(process.execPath, ['-e', script], options),
  }
}

describe('MadoPilot optional sidecar protocol', () => {
  it('validates action-specific flags before spawning', () => {
    expect(() => invocation(['--action', 'capture', '--target', 'bad'])).toThrow(CliError)
    expect(() => invocation(['--action', 'list-targets', '--route', 'system'])).toThrow(CliError)
    expect(() => invocation(['--action', 'find-template', '--target', 'a'.repeat(64), '--template', 'x.png', '--min-score', 'NaN'])).toThrow(CliError)
    expect(() => invocation(['--action', 'click', '--target', 'a'.repeat(64), '--x', '1', '--y', '2'])).toThrow(CliError)
  })

  it('sends one request to a real child process and returns a target list', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'computer-use-mado-'))
    tempDirs.push(directory)
    const script = `let body='';process.stdin.on('data',chunk=>body+=chunk);process.stdin.on('end',()=>{const request=JSON.parse(body);process.stdout.write(JSON.stringify({ok:true,data:[{id:'a'.repeat(64),name:request.action}]})+'\\n')})`
    const result = await runMado(
      invocation(['--action', 'list-targets', '--out', directory]), createDefaultDeps(), fakeEnvironment(script),
    )
    expect(result).toEqual({ ok: true, action: 'list-targets', targets: [{ id: 'a'.repeat(64), name: 'list_targets' }] })
  })

  it('rejects malformed or inconsistent native responses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'computer-use-mado-'))
    tempDirs.push(directory)
    const request = invocation(['--action', 'health', '--out', directory])
    await expect(runMado(request, createDefaultDeps(), fakeEnvironment(`process.stdout.write('not json')`)))
      .rejects.toThrow('invalid JSON')
    await expect(runMado(request, createDefaultDeps(), fakeEnvironment(`process.stdout.write('\\n{"ok":true,"data":{}}');process.exitCode=1`)))
      .rejects.toThrow('inconsistent')
  })

  it('preserves a partial input receipt and signals failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'computer-use-mado-'))
    tempDirs.push(directory)
    const request = invocation(['--action', 'click', '--target', 'a'.repeat(64), '--x', '12', '--y', '18', '--route', 'window-message', '--expected-hash', 'b'.repeat(64), '--out', directory])
    const script = `process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({ok:false,error:{code:'EINPUT',message:'MadoPilot input did not complete',receipt:{outcome:'partial',submitted:2,cleanup:'complete'}}}));process.exitCode=1})`
    const result = await runMado(request, createDefaultDeps(), fakeEnvironment(script))
    expect(result.ok).toBe(false)
    expect(result.receipt).toEqual({ outcome: 'partial', submitted: 2, cleanup: 'complete' })
  })
})
