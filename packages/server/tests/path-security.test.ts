import { mkdtemp, mkdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContextDBService, ContextPathError } from '../src/services/context-db.js'
import { FileSystemService } from '../src/services/filesystem.js'

describe('path security', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'agent-flow-path-test-'))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('keeps context files inside the configured database root', async () => {
    const contextRoot = join(tempRoot, 'context-db')
    const service = new ContextDBService(contextRoot)

    await service.upsertContext('L0', 'project-1', 'architecture.md', '# Architecture')

    await expect(readFile(join(contextRoot, 'L0', 'project-1', 'architecture.md'), 'utf-8'))
      .resolves.toBe('# Architecture')
    await expect(service.getContext('L0', 'project-1', 'architecture.md'))
      .resolves.toBe('# Architecture')
  })

  it('rejects context path traversal in every user-controlled segment', async () => {
    const service = new ContextDBService(join(tempRoot, 'context-db'))

    await expect(service.upsertContext('L0', '..', 'escape.md', 'bad'))
      .rejects.toBeInstanceOf(ContextPathError)
    await expect(service.getContext('L0', 'project-1', '../escape.md'))
      .rejects.toBeInstanceOf(ContextPathError)
    await expect(service.listContextFiles('../L0' as 'L0', 'project-1'))
      .rejects.toBeInstanceOf(ContextPathError)
    await expect(service.deleteContext('SYS', 'not-global', 'rules.md'))
      .rejects.toBeInstanceOf(ContextPathError)
  })

  it('applies the allowed root boundary to snapshots and directory watches', async () => {
    const allowedRoot = join(tempRoot, 'allowed')
    const siblingRoot = join(tempRoot, 'allowed-sibling')
    await mkdir(allowedRoot)
    await mkdir(siblingRoot)

    const service = new FileSystemService()
    service.setAllowedRoots([allowedRoot])

    expect(service.resolveSafePath(join(allowedRoot, 'file.txt'))).toBe(join(allowedRoot, 'file.txt'))
    expect(() => service.resolveSafePath(join(siblingRoot, 'file.txt'))).toThrow('outside allowed directories')
    await expect(service.snapshotFile(join(siblingRoot, 'file.txt'))).rejects.toThrow('outside allowed directories')
    expect(() => service.watchDirectory(siblingRoot, () => {})).toThrow('outside allowed directories')
  })
})
