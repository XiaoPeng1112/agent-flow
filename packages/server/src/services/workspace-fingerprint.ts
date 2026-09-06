import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { lstatSync, readFileSync, readlinkSync } from 'fs'
import { join } from 'path'

/** Read-only identity for tracked and non-ignored untracked source, without touching the index. */
export function workspaceFingerprint(cwd: string): string {
  cwd = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 10_000 }).trim()
  const git = (args: string[]) => execFileSync('git', args, {
    cwd, maxBuffer: 16 * 1024 * 1024, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const hash = createHash('sha256')
  hash.update(git(['rev-parse', '--verify', 'HEAD']))
  hash.update(git(['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--']))
  const files = git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean).sort()
  let bytes = 0
  if (files.length > 2000) throw new Error('Too many untracked files to verify safely')
  for (const file of files) {
    const path = join(cwd, file)
    const info = lstatSync(path)
    bytes += info.size
    if (bytes > 32 * 1024 * 1024) throw new Error('Untracked source exceeds verification size limit')
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error('Unsupported untracked source entry')
    hash.update(JSON.stringify([file, info.mode, info.size]))
    hash.update(info.isSymbolicLink() ? readlinkSync(path) : readFileSync(path))
  }
  return hash.digest('hex')
}
