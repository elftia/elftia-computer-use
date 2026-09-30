import { describe, expect, it } from 'vitest'
import { parseArgv, type Invocation } from './args.js'
import { CliError } from './errors.js'

function expectUsage(argv: string[], messagePart?: string): void {
  let caught: unknown
  try {
    parseArgv(argv)
  } catch (err) {
    caught = err
  }
  expect(caught, `expected EUSAGE for: ${argv.join(' ')}`).toBeInstanceOf(CliError)
  const err = caught as CliError
  expect(err.code).toBe('EUSAGE')
  if (messagePart !== undefined) {
    expect(err.message).toContain(messagePart)
  }
}

function invOf(argv: string[]): Invocation {
  const parsed = parseArgv(argv)
  if (parsed.kind !== 'command') {
    throw new Error(`expected a command for: ${argv.join(' ')}`)
  }
  return parsed.invocation
}

describe('argv parsing: global flags', () => {
  it('handles --help and -h before a command', () => {
    expect(parseArgv(['--help']).kind).toBe('help')
    expect(parseArgv(['-h']).kind).toBe('help')
  })

  it('handles --help after a subcommand (subcommand help)', () => {
    expect(parseArgv(['apps', '--help']).kind).toBe('help')
    expect(parseArgv(['click', '-h']).kind).toBe('help')
  })

  it('handles --version and -V', () => {
    expect(parseArgv(['--version']).kind).toBe('version')
    expect(parseArgv(['-V']).kind).toBe('version')
  })

  it('rejects no command with EUSAGE', () => {
    expectUsage([], 'no command')
  })

  it('rejects unknown commands naming the valid list', () => {
    expectUsage(['blast'], 'unknown command "blast"')
  })

  it('rejects unknown flags before the command', () => {
    expectUsage(['--frobnicate', 'apps'], 'unknown option')
  })

  it('rejects unknown flags for a known command', () => {
    expectUsage(['apps', '--out', 'x'], 'unknown option "--out" for command "apps"')
    expectUsage(['doctor', '--quick'], 'unknown option')
  })

  it('rejects positional junk', () => {
    expectUsage(['apps', 'extra'], 'unexpected positional argument')
  })

  it('rejects duplicate options', () => {
    expectUsage(['click', '--x', '1', '--x', '2'], 'more than once')
  })

  it('rejects value flags without a value', () => {
    expectUsage(['type', '--text'], 'requires a value')
  })

  it('supports --flag=value form', () => {
    const inv = invOf(['click', '--x=500', '--y=300']) as Extract<
      Invocation,
      { command: 'click' }
    >
    expect(inv.x).toBe(500)
    expect(inv.y).toBe(300)
  })
})

describe('argv parsing: apps / get-state / uia-tree', () => {
  it('apps takes no options', () => {
    expect(invOf(['apps'])).toEqual({ command: 'apps' })
  })

  it('get-state parses --app and --out', () => {
    const inv = invOf(['get-state', '--app', '4242', '--out', 'dir']) as Extract<
      Invocation,
      { command: 'get-state' }
    >
    expect(inv.app).toBe(4242)
    expect(inv.out).toBe('dir')
  })

  it('rejects pid 0 for --app', () => {
    expectUsage(['get-state', '--app', '0'], 'must be >= 1')
  })

  it('uia-tree defaults max-depth to 4', () => {
    const inv = invOf(['uia-tree']) as Extract<Invocation, { command: 'uia-tree' }>
    expect(inv.maxDepth).toBe(4)
  })

  it('uia-tree bounds max-depth', () => {
    expectUsage(['uia-tree', '--max-depth', '0'], 'must be >= 1')
    expectUsage(['uia-tree', '--max-depth', '99'], 'must be <= 64')
  })
})

describe('argv parsing: screenshot', () => {
  it('parses decimal and hex window ids', () => {
    const dec = invOf(['screenshot', '--window', '65684']) as Extract<
      Invocation,
      { command: 'screenshot' }
    >
    expect(dec.window).toBe(65684)
    const hex = invOf(['screenshot', '--window', '0x000A0B1C']) as Extract<
      Invocation,
      { command: 'screenshot' }
    >
    expect(hex.window).toBe(0x0a0b1c)
  })

  it('rejects malformed window ids', () => {
    expectUsage(['screenshot', '--window', 'zzz'], 'window id')
  })

  it('validates max-edge', () => {
    expectUsage(['screenshot', '--max-edge', '0'], 'must be >= 1')
    expectUsage(['screenshot', '--max-edge', '-5'], 'must be >= 1')
    const inv = invOf(['screenshot', '--max-edge', '1280']) as Extract<
      Invocation,
      { command: 'screenshot' }
    >
    expect(inv.maxEdge).toBe(1280)
  })
})

describe('argv parsing: click', () => {
  it('defaults button/count/mods for coordinate clicks', () => {
    const inv = invOf(['click', '--x', '500', '--y', '300']) as Extract<
      Invocation,
      { command: 'click' }
    >
    expect(inv).toMatchObject({
      mode: 'coords',
      x: 500,
      y: 300,
      button: 'left',
      clickCount: 1,
      mods: [],
      shot: false,
    })
  })

  it('allows negative coordinates (multi-monitor desktops)', () => {
    const inv = invOf(['click', '--x', '-10', '--y', '-5']) as Extract<
      Invocation,
      { command: 'click' }
    >
    expect(inv.x).toBe(-10)
    expect(inv.y).toBe(-5)
  })

  it('rejects x without y', () => {
    expectUsage(['click', '--x', '5'], 'together')
  })

  it('rejects both addressing modes at once', () => {
    expectUsage(
      ['click', '--x', '1', '--y', '2', '--state', 's.json', '--element', '0'],
      'not both',
    )
  })

  it('rejects neither addressing mode', () => {
    expectUsage(['click'], 'requires either')
  })

  it('rejects --double together with --triple', () => {
    expectUsage(['click', '--x', '1', '--y', '2', '--double', '--triple'], 'mutually exclusive')
  })

  it('rejects bad button values', () => {
    expectUsage(['click', '--x', '1', '--y', '2', '--button', 'side'], 'left, right, or middle')
  })

  it('rejects bad mods tokens', () => {
    expectUsage(['click', '--x', '1', '--y', '2', '--mods', 'ctrl+w'], 'not supported')
    expectUsage(['click', '--x', '1', '--y', '2', '--mods', 'ctrl+ctrl'], 'repeated')
  })

  it('parses combinable mods and click count', () => {
    const inv = invOf([
      'click', '--x', '10', '--y', '20', '--double', '--mods', 'ctrl+shift',
    ]) as Extract<Invocation, { command: 'click' }>
    expect(inv.clickCount).toBe(2)
    expect(inv.mods).toEqual(['ctrl', 'shift'])
  })

  it('parses element addressing', () => {
    const inv = invOf(['click', '--state', 's.json', '--element', '3']) as Extract<
      Invocation,
      { command: 'click' }
    >
    expect(inv.mode).toBe('element')
    expect(inv.stateFile).toBe('s.json')
    expect(inv.element).toBe(3)
  })

  it('rejects state without element and vice versa', () => {
    expectUsage(['click', '--state', 's.json'], 'together')
    expectUsage(['click', '--element', '3'], 'together')
  })

  it('rejects negative element indexes', () => {
    expectUsage(['click', '--state', 's.json', '--element', '-1'], 'must be >= 0')
  })
})

describe('argv parsing: type / key / scroll / drag', () => {
  it('type requires non-empty text', () => {
    expectUsage(['type'], '--text is required')
    expectUsage(['type', '--text', ''], 'must not be empty')
    const inv = invOf(['type', '--text', '你好 🌏']) as Extract<Invocation, { command: 'type' }>
    expect(inv.text).toBe('你好 🌏')
  })

  it('key parses combos', () => {
    const inv = invOf(['key', '--combo', 'ctrl+s']) as Extract<Invocation, { command: 'key' }>
    expect(inv.combo).toBe('ctrl+s')
    expect(inv.vk).toBe(0x53)
    expect(inv.mods).toEqual(['ctrl'])
  })

  it('key rejects unknown keys and empty segments', () => {
    expectUsage(['key', '--combo', 'ctrl+pace'], 'not a known key')
    expectUsage(['key', '--combo', 'ctrl+'], 'empty segment')
    expectUsage(['key'], '--combo is required')
  })

  it('key parses hold-ms within 1..60000', () => {
    const inv = invOf(['key', '--combo', 'w', '--hold-ms', '1500']) as Extract<Invocation, { command: 'key' }>
    expect(inv.holdMs).toBe(1500)
    const plain = invOf(['key', '--combo', 'w']) as Extract<Invocation, { command: 'key' }>
    expect(plain.holdMs).toBeUndefined()
    expectUsage(['key', '--combo', 'w', '--hold-ms', '0'], '--hold-ms must be >= 1')
    expectUsage(['key', '--combo', 'w', '--hold-ms', '60001'], '--hold-ms must be <= 60000')
    expectUsage(['key', '--combo', 'w', '--hold-ms', 'fast'], '--hold-ms must be an integer')
  })

  it('scroll requires all four parameters with enum validation', () => {
    expectUsage(['scroll', '--x', '1', '--y', '2', '--direction', 'up'], '--amount is required')
    expectUsage(
      ['scroll', '--x', '1', '--y', '2', '--direction', 'sideways', '--amount', '1'],
      'up, down, left, or right',
    )
    const inv = invOf([
      'scroll', '--x', '640', '--y', '400', '--direction', 'down', '--amount', '3',
    ]) as Extract<Invocation, { command: 'scroll' }>
    expect(inv).toMatchObject({ x: 640, y: 400, direction: 'down', amount: 3 })
  })

  it('drag requires all four coordinates', () => {
    expectUsage(['drag', '--from-x', '1', '--from-y', '2', '--to-x', '3'], '--to-y is required')
    const inv = invOf(['drag', '--from-x', '100', '--from-y', '100', '--to-x', '400', '--to-y', '400']) as Extract<
      Invocation,
      { command: 'drag' }
    >
    expect(inv).toMatchObject({ fromX: 100, fromY: 100, toX: 400, toY: 400 })
  })
})
