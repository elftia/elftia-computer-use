import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcScripts = join(root, 'src', 'platform', 'windows', 'scripts')
const distScripts = join(root, 'dist', 'platform', 'windows', 'scripts')

mkdirSync(distScripts, { recursive: true })
let copied = 0
for (const entry of readdirSync(srcScripts)) {
  if (entry.endsWith('.ps1')) {
    cpSync(join(srcScripts, entry), join(distScripts, entry))
    copied += 1
  }
}

const cliPath = join(root, 'dist', 'cli.js')
if (!existsSync(cliPath)) {
  throw new Error('dist/cli.js missing — did tsc run first?')
}
const head = readFileSync(cliPath, 'utf8')
if (!head.startsWith('#!')) {
  throw new Error('dist/cli.js is missing its node shebang')
}

console.log(`build: copied ${copied} PowerShell script(s), bin entry verified`)
