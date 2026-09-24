import { CliError } from './errors.js'
import { parseCombo, parseMods, type Modifier } from './keys.js'
import type { Region } from './platform/types.js'

export type CommandName =
  | 'apps'
  | 'get-state'
  | 'screenshot'
  | 'crop'
  | 'click'
  | 'type'
  | 'key'
  | 'scroll'
  | 'drag'
  | 'uia-tree'
  | 'doctor'
  | 'mado'

export const COMMAND_NAMES: readonly CommandName[] = [
  'apps',
  'get-state',
  'screenshot',
  'crop',
  'click',
  'type',
  'key',
  'scroll',
  'drag',
  'uia-tree',
  'doctor',
  'mado',
]

export type MadoInvocation =
  | { command: 'mado'; action: 'health' | 'list-targets'; out?: string }
  | { command: 'mado'; action: 'capture' | 'read-text'; target: string; out?: string }
  | { command: 'mado'; action: 'find-template' | 'wait-template'; target: string; template: string; minScore: number; timeoutMs?: number; out?: string }
  | { command: 'mado'; action: 'click'; target: string; x: number; y: number; route: 'system' | 'window-message' | 'process-directed'; expectedHash: string; out?: string }

export type Button = 'left' | 'right' | 'middle'
export type Direction = 'up' | 'down' | 'left' | 'right'

export type Invocation =
  | { command: 'apps' }
  | { command: 'get-state'; app?: number; out?: string }
  | { command: 'screenshot'; window?: number; out?: string; maxEdge?: number; region?: Region }
  | { command: 'crop'; in: string; region: Region; out?: string }
  | {
      command: 'click'
      mode: 'coords' | 'element'
      x?: number
      y?: number
      button: Button
      clickCount: 1 | 2 | 3
      mods: Modifier[]
      stateFile?: string
      element?: number
      shot: boolean
      out?: string
    }
  | { command: 'type'; text: string; shot: boolean; out?: string }
  | {
      command: 'key'
      combo: string
      vk: number
      extended: boolean
      mods: Modifier[]
      shot: boolean
      out?: string
    }
  | {
      command: 'scroll'
      x: number
      y: number
      direction: Direction
      amount: number
      shot: boolean
      out?: string
    }
  | {
      command: 'drag'
      fromX: number
      fromY: number
      toX: number
      toY: number
      shot: boolean
      out?: string
    }
  | { command: 'uia-tree'; app?: number; maxDepth: number; out?: string }
  | { command: 'doctor' }
  | MadoInvocation

export type ParseResult =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'command'; invocation: Invocation }

const VALUE_FLAGS: Record<CommandName, readonly string[]> = {
  apps: [],
  'get-state': ['app', 'out'],
  screenshot: ['window', 'out', 'max-edge', 'region'],
  crop: ['in', 'region', 'out'],
  click: ['x', 'y', 'button', 'mods', 'state', 'element', 'out'],
  type: ['text', 'out'],
  key: ['combo', 'out'],
  scroll: ['x', 'y', 'direction', 'amount', 'out'],
  drag: ['from-x', 'from-y', 'to-x', 'to-y', 'out'],
  'uia-tree': ['app', 'max-depth', 'out'],
  doctor: [],
  mado: ['action', 'target', 'template', 'min-score', 'timeout-ms', 'x', 'y', 'route', 'expected-hash', 'out'],
}

const BOOL_FLAGS: Record<CommandName, readonly string[]> = {
  apps: [],
  'get-state': [],
  screenshot: [],
  crop: [],
  click: ['double', 'triple', 'shot'],
  type: ['shot'],
  key: ['shot'],
  scroll: ['shot'],
  drag: ['shot'],
  'uia-tree': [],
  doctor: [],
  mado: [],
}

type FlagMap = Map<string, string | boolean>

function usage(message: string): never {
  throw new CliError('EUSAGE', message)
}

function parseFlags(
  command: CommandName,
  tokens: string[],
): { kind: 'flags'; flags: FlagMap } | { kind: 'help' } | { kind: 'version' } {
  const flags: FlagMap = new Map()
  const valueSet = VALUE_FLAGS[command]
  const boolSet = BOOL_FLAGS[command]
  let k = 0
  while (k < tokens.length) {
    const token = tokens[k]
    if (token === '-h' || token === '--help') {
      return { kind: 'help' }
    }
    if (token === '-V' || token === '--version') {
      return { kind: 'version' }
    }
    if (!token.startsWith('--')) {
      usage(`unexpected positional argument "${token}" — options must look like --flag value`)
    }
    let name = token.slice(2)
    let inlineValue: string | undefined
    const eq = name.indexOf('=')
    if (eq >= 0) {
      inlineValue = name.slice(eq + 1)
      name = name.slice(0, eq)
    }
    if (name === '') {
      usage(`malformed option "${token}"`)
    }
    if (flags.has(name)) {
      usage(`option --${name} was given more than once`)
    }
    if (valueSet.includes(name)) {
      let value = inlineValue
      if (value === undefined) {
        k += 1
        if (k >= tokens.length) {
          usage(`option --${name} requires a value`)
        }
        value = tokens[k]
      }
      flags.set(name, value)
    } else if (boolSet.includes(name)) {
      if (inlineValue !== undefined) {
        usage(`option --${name} does not take a value`)
      }
      flags.set(name, true)
    } else {
      usage(`unknown option "--${name}" for command "${command}"`)
    }
    k += 1
  }
  return { kind: 'flags', flags }
}

function getString(flags: FlagMap, name: string): string | undefined {
  const raw = flags.get(name)
  return typeof raw === 'string' ? raw : undefined
}

function requireString(flags: FlagMap, name: string): string {
  const raw = getString(flags, name)
  if (raw === undefined) {
    usage(`option --${name} is required`)
  }
  return raw
}

function getInt(
  flags: FlagMap,
  name: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  const raw = getString(flags, name)
  if (raw === undefined) {
    return undefined
  }
  if (!/^-?\d+$/.test(raw)) {
    usage(`option --${name} must be an integer, got "${raw}"`)
  }
  const n = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(n)) {
    usage(`option --${name} must be a safe integer`)
  }
  if (opts.min !== undefined && n < opts.min) {
    usage(`option --${name} must be >= ${opts.min}, got ${n}`)
  }
  if (opts.max !== undefined && n > opts.max) {
    usage(`option --${name} must be <= ${opts.max}, got ${n}`)
  }
  return n
}

function madoScore(flags: FlagMap): number {
  const raw = getString(flags, 'min-score')
  if (raw === undefined) return 0.85
  const score = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(score) || score < 0 || score > 1) {
    usage('--min-score must be a finite number between 0 and 1')
  }
  return score
}

function rejectMadoFlags(flags: FlagMap, allowed: readonly string[]): void {
  for (const key of flags.keys()) {
    if (!allowed.includes(key)) usage(`--${key} is not valid for this mado action`)
  }
}

function madoInvocation(flags: FlagMap): MadoInvocation {
  const action = requireString(flags, 'action')
  const out = getString(flags, 'out')
  if (action === 'health' || action === 'list-targets') {
    rejectMadoFlags(flags, ['action', 'out'])
    return { command: 'mado', action, out }
  }
  const target = requireString(flags, 'target')
  if (!/^[a-f0-9]{64}$/.test(target)) usage('--target must be an id returned by mado list-targets')
  if (action === 'capture' || action === 'read-text') {
    rejectMadoFlags(flags, ['action', 'target', 'out'])
    return { command: 'mado', action, target, out }
  }
  if (action === 'find-template' || action === 'wait-template') {
    rejectMadoFlags(flags, ['action', 'target', 'template', 'min-score', 'timeout-ms', 'out'])
    if (action === 'find-template' && flags.has('timeout-ms')) usage('--timeout-ms requires wait-template')
    const template = requireString(flags, 'template')
    if (!template) usage('--template must not be empty')
    const timeoutMs = action === 'wait-template' ? getInt(flags, 'timeout-ms', { min: 1, max: 120000 }) ?? 10000 : undefined
    return { command: 'mado', action, target, template, minScore: madoScore(flags), timeoutMs, out }
  }
  if (action === 'click') {
    rejectMadoFlags(flags, ['action', 'target', 'x', 'y', 'route', 'expected-hash', 'out'])
    const route = requireString(flags, 'route')
    if (route !== 'system' && route !== 'window-message' && route !== 'process-directed') {
      usage('--route must be system, window-message or process-directed')
    }
    const expectedHash = requireString(flags, 'expected-hash')
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) usage('--expected-hash must be the image_hash returned by mado capture')
    return { command: 'mado', action, target, x: requireInt(flags, 'x', { min: 0 }), y: requireInt(flags, 'y', { min: 0 }), route, expectedHash, out }
  }
  usage(`unknown mado action "${action}"`)
}

function requireInt(flags: FlagMap, name: string, opts: { min?: number; max?: number } = {}): number {
  const n = getInt(flags, name, opts)
  if (n === undefined) {
    usage(`option --${name} is required`)
  }
  return n
}

/** Screen coordinates may be negative (multi-monitor desktops). */
function getCoord(flags: FlagMap, name: string): number | undefined {
  return getInt(flags, name)
}

/** Window handles: decimal or 0x-prefixed hex; USER handles fit in 32 bits. */
function getWindowId(flags: FlagMap): number | undefined {
  const raw = getString(flags, 'window')
  if (raw === undefined) {
    return undefined
  }
  const isHex = /^0x[0-9a-f]+$/i.test(raw)
  if (!isHex && !/^\d+$/.test(raw)) {
    usage(`option --window must be a decimal or 0x-prefixed window id, got "${raw}"`)
  }
  const n = Number.parseInt(raw, isHex ? 16 : 10)
  if (!Number.isSafeInteger(n) || n < 0) {
    usage(`option --window is not a valid window id: "${raw}"`)
  }
  return n
}

function getBool(flags: FlagMap, name: string): boolean {
  return flags.get(name) === true
}

function parseRegion(raw: string): Region {
  const parts = raw.split(',').map((p) => p.trim())
  if (parts.length !== 4 || parts.some((p) => !/^-?\d+$/.test(p))) {
    usage('--region expects four integers: x1,y1,x2,y2')
  }
  const [x1, y1, x2, y2] = parts.map((p) => Number.parseInt(p, 10))
  if (x2 <= x1 || y2 <= y1) {
    usage('--region requires x2 > x1 and y2 > y1')
  }
  if (x1 < 0 || y1 < 0) {
    usage('--region coordinates must be non-negative')
  }
  return { x1, y1, x2, y2 }
}

function getRegion(flags: FlagMap): Region | undefined {
  const raw = getString(flags, 'region')
  return raw === undefined ? undefined : parseRegion(raw)
}

function buildInvocation(command: CommandName, flags: FlagMap): Invocation {
  switch (command) {
    case 'apps':
    case 'doctor':
      return { command }

    case 'mado':
      return madoInvocation(flags)

    case 'get-state': {
      const app = getInt(flags, 'app', { min: 1 })
      const out = getString(flags, 'out')
      return { command, app, out }
    }

    case 'screenshot': {
      const window = getWindowId(flags)
      const maxEdge = getInt(flags, 'max-edge', { min: 1, max: 65535 })
      const region = getRegion(flags)
      if (window !== undefined && region !== undefined) {
        usage('use either --window or --region, not both')
      }
      const out = getString(flags, 'out')
      return { command, window, maxEdge, region, out }
    }

    case 'crop': {
      const inPath = getString(flags, 'in')
      if (!inPath) {
        usage('crop requires --in <png>')
      }
      const region = getRegion(flags)
      if (!region) {
        usage('crop requires --region <x1,y1,x2,y2>')
      }
      const out = getString(flags, 'out')
      return { command, in: inPath, region, out }
    }

    case 'click': {
      const hasXY = flags.has('x') || flags.has('y')
      const hasState = flags.has('state') || flags.has('element')
      if (hasXY && hasState) {
        usage('use either --x/--y or --state/--element, not both')
      }
      if (!hasXY && !hasState) {
        usage('click requires either --x/--y or --state/--element')
      }
      const double = getBool(flags, 'double')
      const triple = getBool(flags, 'triple')
      if (double && triple) {
        usage('--double and --triple are mutually exclusive')
      }
      const clickCount: 1 | 2 | 3 = triple ? 3 : double ? 2 : 1
      const buttonRaw = getString(flags, 'button') ?? 'left'
      if (buttonRaw !== 'left' && buttonRaw !== 'right' && buttonRaw !== 'middle') {
        usage(`option --button must be left, right, or middle, got "${buttonRaw}"`)
      }
      const button = buttonRaw as Button
      const modsRaw = getString(flags, 'mods')
      const mods = modsRaw === undefined ? [] : parseMods(modsRaw)
      const shot = getBool(flags, 'shot')
      const out = getString(flags, 'out')
      if (hasXY) {
        if (!flags.has('x') || !flags.has('y')) {
          usage('--x and --y must be given together')
        }
        return {
          command,
          mode: 'coords',
          x: getCoord(flags, 'x'),
          y: getCoord(flags, 'y'),
          button,
          clickCount,
          mods,
          shot,
          out,
        }
      }
      if (!flags.has('state') || !flags.has('element')) {
        usage('--state and --element must be given together')
      }
      return {
        command,
        mode: 'element',
        stateFile: requireString(flags, 'state'),
        element: requireInt(flags, 'element', { min: 0 }),
        button,
        clickCount,
        mods,
        shot,
        out,
      }
    }

    case 'type': {
      const text = requireString(flags, 'text')
      if (text === '') {
        usage('option --text must not be empty')
      }
      return { command, text, shot: getBool(flags, 'shot'), out: getString(flags, 'out') }
    }

    case 'key': {
      const combo = requireString(flags, 'combo')
      const parsed = parseCombo(combo)
      return {
        command,
        combo,
        vk: parsed.vk,
        extended: parsed.extended,
        mods: parsed.mods,
        shot: getBool(flags, 'shot'),
        out: getString(flags, 'out'),
      }
    }

    case 'scroll': {
      const directionRaw = requireString(flags, 'direction')
      if (
        directionRaw !== 'up' &&
        directionRaw !== 'down' &&
        directionRaw !== 'left' &&
        directionRaw !== 'right'
      ) {
        usage(`option --direction must be up, down, left, or right, got "${directionRaw}"`)
      }
      return {
        command,
        x: requireInt(flags, 'x'),
        y: requireInt(flags, 'y'),
        direction: directionRaw as Direction,
        amount: requireInt(flags, 'amount', { min: 1, max: 1000 }),
        shot: getBool(flags, 'shot'),
        out: getString(flags, 'out'),
      }
    }

    case 'drag': {
      return {
        command,
        fromX: requireInt(flags, 'from-x'),
        fromY: requireInt(flags, 'from-y'),
        toX: requireInt(flags, 'to-x'),
        toY: requireInt(flags, 'to-y'),
        shot: getBool(flags, 'shot'),
        out: getString(flags, 'out'),
      }
    }

    case 'uia-tree': {
      const app = getInt(flags, 'app', { min: 1 })
      const maxDepth = getInt(flags, 'max-depth', { min: 1, max: 64 }) ?? 4
      const out = getString(flags, 'out')
      return { command, app, maxDepth, out }
    }
  }
}

/** Parse raw argv (excluding node/script) into a command invocation. */
export function parseArgv(argv: string[]): ParseResult {
  if (argv.length === 0) {
    usage('no command given — run "computer-use --help" for usage')
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    return { kind: 'help' }
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    return { kind: 'version' }
  }
  if (argv[0].startsWith('-')) {
    usage(`unknown option "${argv[0]}" before command (expected a command; see --help)`)
  }
  const command = argv[0] as CommandName
  if (!COMMAND_NAMES.includes(command)) {
    usage(`unknown command "${command}" — valid commands: ${COMMAND_NAMES.join(', ')}`)
  }
  const parsed = parseFlags(command, argv.slice(1))
  if (parsed.kind !== 'flags') {
    return parsed
  }
  return { kind: 'command', invocation: buildInvocation(command, parsed.flags) }
}
