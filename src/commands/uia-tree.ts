import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Invocation } from '../args.js'
import { CliError } from '../errors.js'
import { ensureDir, resolveOutDir } from '../out-dir.js'
import type { CommandDeps, CommandPayload } from './deps.js'

type UiaTreeInvocation = Extract<Invocation, { command: 'uia-tree' }>

/** Default cap on emitted tree nodes (overflow marks `truncated: true`). */
export const UIA_TREE_MAX_NODES = 4000

/**
 * uia-tree: the tree itself ALWAYS goes to a file; stdout carries only the
 * path and the node count (frozen payload discipline).
 */
export async function runUiaTree(
  inv: UiaTreeInvocation,
  deps: CommandDeps,
): Promise<CommandPayload> {
  const outPath =
    inv.out !== undefined && inv.out !== ''
      ? isAbsolute(inv.out)
        ? inv.out
        : resolve(deps.cwd, inv.out)
      : join(resolveOutDir(deps), 'uia-tree.json')
  ensureDir(dirname(outPath))

  const result = await deps.backend.uiaTree({
    mode: 'tree',
    pid: inv.app,
    maxDepth: inv.maxDepth,
    maxNodes: UIA_TREE_MAX_NODES,
    outPath,
  })
  if (result.kind !== 'tree') {
    throw new CliError('EBACKEND', 'tree walk returned an unexpected result shape')
  }
  return {
    ok: true,
    file: result.file,
    count: result.count,
    truncated: result.truncated,
  }
}
