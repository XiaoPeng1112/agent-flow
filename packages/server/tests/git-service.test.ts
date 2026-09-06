import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GitService } from '../src/services/git.js'

describe('GitService revision handling', () => {
  it('uses verified revisions as arguments and reads actual diffs', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agentflow-git-'))
    const git = (args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
    try {
      git(['init', '-q'])
      git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
        'commit', '--allow-empty', '-qm', 'baseline'])
      const service = new GitService()
      expect(service.getDiffBetween(cwd, 'HEAD', 'HEAD')).toBe('')
      expect(() => service.getDiffBetween(cwd, 'HEAD;printf unexpected')).toThrow()
      expect(() => service.getDiffBetween(cwd, '--output=/tmp/unexpected')).toThrow()
      writeFileSync(join(cwd, 'example.txt'), 'new content\n')
      git(['add', 'example.txt'])
      git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
        'commit', '-qm', 'change'])
      expect(service.getDiffBetween(cwd, 'HEAD~1')).toContain('+new content')
      expect(service.getChangedFiles(cwd, 'HEAD~1')).toEqual([{ file: 'example.txt', additions: 1, deletions: 0 }])
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })
})
