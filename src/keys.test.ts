import { describe, expect, it } from 'vitest'
import { CliError } from './errors.js'
import { parseCombo, parseMods } from './keys.js'

describe('key combo parsing', () => {
  it('parses simple combos', () => {
    expect(parseCombo('ctrl+s')).toEqual({ mods: ['ctrl'], key: 's', vk: 0x53, extended: false })
    expect(parseCombo('alt+f4')).toEqual({ mods: ['alt'], key: 'f4', vk: 0x73, extended: false })
  })

  it('parses stacked modifiers and bare keys', () => {
    expect(parseCombo('ctrl+shift+t').mods).toEqual(['ctrl', 'shift'])
    expect(parseCombo('enter').vk).toBe(0x0d)
    expect(parseCombo('enter').mods).toEqual([])
  })

  it('marks extended keys', () => {
    expect(parseCombo('left').extended).toBe(true)
    expect(parseCombo('delete').extended).toBe(true)
    expect(parseCombo('a').extended).toBe(false)
    expect(parseCombo('home').vk).toBe(0x24)
  })

  it('resolves common aliases', () => {
    expect(parseCombo('return').key).toBe('enter')
    expect(parseCombo('del').key).toBe('delete')
    expect(parseCombo('spacebar').vk).toBe(0x20)
    expect(parseCombo('escape').key).toBe('esc')
  })

  it('rejects unknown keys, bad modifiers, and repeats', () => {
    expect(() => parseCombo('ctrl+pace')).toThrow(CliError)
    expect(() => parseCombo('win+s')).toThrow(/not supported/)
    expect(() => parseCombo('ctrl+ctrl+s')).toThrow(/repeated/)
    expect(() => parseCombo('ctrl+')).toThrow(/empty segment/)
  })
})

describe('mods parsing (--mods)', () => {
  it('parses single and combinable modifiers', () => {
    expect(parseMods('ctrl')).toEqual(['ctrl'])
    expect(parseMods('ctrl+shift')).toEqual(['ctrl', 'shift'])
    expect(parseMods('alt')).toEqual(['alt'])
  })

  it('rejects unknown, repeated, and empty tokens', () => {
    expect(() => parseMods('meta')).toThrow(CliError)
    expect(() => parseMods('shift+shift')).toThrow(/repeated/)
    expect(() => parseMods('ctrl+')).toThrow(/empty segment/)
  })
})
