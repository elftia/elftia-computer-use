import { CliError } from './errors.js'

/** Modifier keys usable in --mods / key combos (frozen contract: ctrl|shift|alt). */
export const MODIFIER_NAMES = ['ctrl', 'shift', 'alt'] as const
export type Modifier = (typeof MODIFIER_NAMES)[number]

/** Virtual-key table (Win32 VK_* codes). Shared by arg validation; the exact
 * same code is forwarded to the PowerShell input injector. */
const VK_TABLE: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  pause: 0x13,
  capslock: 0x14,
  esc: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  printscreen: 0x2c,
  insert: 0x2d,
  delete: 0x2e,
  lwin: 0x5b,
  rwin: 0x5c,
  apps: 0x5d,
  numpadmultiply: 0x6a,
  numpadadd: 0x6b,
  numpadsubtract: 0x6d,
  numpaddecimal: 0x6e,
  numpaddivide: 0x6f,
  numlock: 0x90,
  scrolllock: 0x91,
  semicolon: 0xba,
  plus: 0xbb,
  comma: 0xbc,
  minus: 0xbd,
  period: 0xbe,
  slash: 0xbf,
  backquote: 0xc0,
  lbracket: 0xdb,
  backslash: 0xdc,
  rbracket: 0xdd,
  quote: 0xde,
}

// Letters (0x41..0x5A), digits (0x30..0x39), F1..F24 (0x70..0x87), numpad digits (0x60..0x69).
// Key names are normalized to lowercase everywhere (see lookupKey).
for (let c = 0x41; c <= 0x5a; c += 1) VK_TABLE[String.fromCharCode(c).toLowerCase()] = c
for (let d = 0; d <= 9; d += 1) VK_TABLE[String(d)] = 0x30 + d
for (let f = 1; f <= 24; f += 1) VK_TABLE[`f${f}`] = 0x70 + f - 1
for (let n = 0; n <= 9; n += 1) VK_TABLE[`numpad${n}`] = 0x60 + n

/** Keys that must be sent with KEYEVENTF_EXTENDEDKEY (navigation cluster etc.). */
const EXTENDED_KEYS = new Set([
  'insert',
  'delete',
  'home',
  'end',
  'pageup',
  'pagedown',
  'left',
  'up',
  'right',
  'down',
  'printscreen',
  'divide',
  'apps',
])

const KEY_ALIASES: Record<string, string> = {
  return: 'enter',
  escape: 'esc',
  del: 'delete',
  spacebar: 'space',
  pgup: 'pageup',
  pgdn: 'pagedown',
  arrowleft: 'left',
  arrowup: 'up',
  arrowright: 'right',
  arrowdown: 'down',
  multiply: 'numpadmultiply',
  subtract: 'numpadsubtract',
  divide: 'numpaddivide',
  decimal: 'numpaddecimal',
}

export interface ParsedCombo {
  mods: Modifier[]
  key: string
  vk: number
  extended: boolean
}

export function lookupKey(rawName: string): { key: string; vk: number; extended: boolean } | undefined {
  const name = rawName.toLowerCase()
  const canonical = KEY_ALIASES[name] ?? name
  const vk = VK_TABLE[canonical]
  if (vk === undefined) {
    return undefined
  }
  return { key: canonical, vk, extended: EXTENDED_KEYS.has(canonical) }
}

/**
 * Parse a key combo such as `ctrl+s`, `ctrl+shift+t`, `alt+f4`, or a bare `enter`.
 * The LAST '+'-separated token is the key; every earlier token must be a modifier.
 */
export function parseCombo(combo: string, flagName = '--combo'): ParsedCombo {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase())
  if (parts.length === 0 || parts.some((p) => p === '')) {
    throw new CliError('EUSAGE', `${flagName} "${combo}" is not a valid combo (empty segment)`)
  }
  // The LAST '+'-separated token is the key; every earlier token is a modifier.
  const keyName = parts[parts.length - 1]
  const modNames = parts.slice(0, -1)
  const mods: Modifier[] = []
  for (const mod of modNames) {
    if (!MODIFIER_NAMES.includes(mod as Modifier)) {
      throw new CliError(
        'EUSAGE',
        `${flagName} modifier "${mod}" is not supported (use ctrl, shift, alt)`,
      )
    }
    if (mods.includes(mod as Modifier)) {
      throw new CliError('EUSAGE', `${flagName} modifier "${mod}" is repeated`)
    }
    mods.push(mod as Modifier)
  }
  const found = lookupKey(keyName)
  if (found === undefined) {
    throw new CliError('EUSAGE', `${flagName} key "${keyName}" is not a known key name`)
  }
  return { mods, key: found.key, vk: found.vk, extended: found.extended }
}

/** Parse `--mods ctrl+shift` into a normalized modifier list. */
export function parseMods(spec: string, flagName = '--mods'): Modifier[] {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase())
  if (parts.length === 0 || parts.some((p) => p === '')) {
    throw new CliError('EUSAGE', `${flagName} "${spec}" is not valid (empty segment)`)
  }
  const mods: Modifier[] = []
  for (const mod of parts) {
    if (!MODIFIER_NAMES.includes(mod as Modifier)) {
      throw new CliError(
        'EUSAGE',
        `${flagName} modifier "${mod}" is not supported (use ctrl, shift, alt)`,
      )
    }
    if (mods.includes(mod as Modifier)) {
      throw new CliError('EUSAGE', `${flagName} modifier "${mod}" is repeated`)
    }
    mods.push(mod as Modifier)
  }
  return mods
}
