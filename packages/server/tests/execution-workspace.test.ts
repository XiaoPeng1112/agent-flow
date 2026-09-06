import { ExecutionWorkerClient } from '../src/services/execution-worker-client.js'
import { executionEnvironment } from '../src/services/execution-environment.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RepoIsolationService } from '../src/services/repo-isolation.js'
import { ArtifactMergeService } from '../src/services/artifact-merge.js'
import { GitService } from '../src/services/git.js'
import { workspaceFingerprint } from '../src/services/workspace-fingerprint.js'

describe('Isolated execution and delivery', () => {
  let root: string, project: string, isolation: RepoIsolationService, reviews: ArtifactMergeService
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()
  const prepare = (turnId: string, nodeId = turnId, predecessorTurnIds: string[] = [], previousTurnId?: string) =>
    isolation.executions.prepare({ turnId, nodeId, runId: 'run', agentId: 'agent', projectPath: project,
      predecessorTurnIds, previousTurnId })
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentflow-worktree-'))
    project = join(root, 'project')
    mkdirSync(project)
    git(['init', '-q', '-b', 'main'])
    writeFileSync(join(project, 'source.txt'), 'baseline\n')
    git(['add', '.'])
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
      'commit', '-qm', 'baseline'])
    isolation = new RepoIsolationService(join(root, 'workspaces'))
    reviews = new ArtifactMergeService(isolation, new GitService())
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('isolates sibling edits and merges approved predecessor snapshots into a successor', () => {
    const original = workspaceFingerprint(project)
    const left = prepare('left')
    const right = prepare('right')
    writeFileSync(join(left.execution.cwd, 'left.txt'), 'left')
    writeFileSync(join(right.execution.cwd, 'right.txt'), 'right')
    expect(existsSync(join(right.execution.cwd, 'left.txt'))).toBe(false)
    isolation.executions.snapshot('left')
    isolation.executions.snapshot('right')
    const child = prepare('child', 'child', ['left', 'right'])
    expect(readFileSync(join(child.execution.cwd, 'left.txt'), 'utf8')).toBe('left')
    expect(readFileSync(join(child.execution.cwd, 'right.txt'), 'utf8')).toBe('right')
    expect(workspaceFingerprint(project)).toBe(original)
    expect(git(['status', '--porcelain'])).toBe('')
  })

  it('creates one immutable run baseline when independent workers prepare concurrently', async () => {
    const before = workspaceFingerprint(project)
    const workers = ['first_worker', 'second_worker'].map(turnId => new ExecutionWorkerClient({
      turnId, prompt: '', script: `echo ${turnId} > output.txt`, cwd: project, environment: executionEnvironment(), timeoutMs: 5000,
      workspace: { root: isolation.executions.root, prepare: { turnId, nodeId: turnId, runId: 'parallel_run',
        agentId: 'agent', projectPath: project, predecessorTurnIds: [] } },
    }, () => {}, () => true))
    try {
      const results = await Promise.all(workers.map(worker => worker.result))
      expect(results.map(result => result.success)).toEqual([true, true])
      const first = isolation.executions.get('first_worker')!
      const second = isolation.executions.get('second_worker')!
      expect(first.execution.baseCommit).toBe(second.execution.baseCommit)
      expect(first.execution.cwd).not.toBe(second.execution.cwd)
      expect(workspaceFingerprint(project)).toBe(before)
    } finally {
      workers.forEach(worker => worker.cancel())
      await Promise.all(workers.map(worker => worker.result))
    }
  }, 15_000)

  it('restores the ledger after restart and preserves interrupted edits in an independent retry', () => {
    const first = prepare('first', 'node')
    writeFileSync(join(first.execution.cwd, 'unfinished.txt'), 'fix me')
    isolation = new RepoIsolationService(join(root, 'workspaces'))
    const retry = prepare('retry', 'node', [], 'first')
    expect(retry.execution.cwd).not.toBe(first.execution.cwd)
    expect(readFileSync(join(retry.execution.cwd, 'unfinished.txt'), 'utf8')).toBe('fix me')
    writeFileSync(join(retry.execution.cwd, 'unfinished.txt'), 'fixed')
    expect(readFileSync(join(first.execution.cwd, 'unfinished.txt'), 'utf8')).toBe('fix me')
    expect(isolation.getWorkspace('first')?.turnId).toBe('first')
    expect(isolation.getActiveWorkspaces().map(w => w.turnId)).toEqual(['first', 'retry'])
  })

  it('fails on conflicting predecessors without changing the project', () => {
    const before = workspaceFingerprint(project)
    for (const id of ['a', 'b']) {
      const workspace = prepare(id)
      writeFileSync(join(workspace.execution.cwd, 'source.txt'), id)
      isolation.executions.snapshot(id)
    }
    expect(() => prepare('conflict', 'conflict', ['a', 'b'])).toThrow()
    expect(workspaceFingerprint(project)).toBe(before)
    const conflicted = isolation.executions.get('conflict')!
    expect(conflicted).toBeDefined()
    isolation.executions.git(conflicted.execution.cwd, ['merge', '--abort'])
    expect(() => isolation.executions.snapshot('conflict')).toThrow()
    expect(existsSync(join(root, 'workspaces', 'execution', 'trees', 'run', 'conflict'))).toBe(true)
  })

  it('refuses a dirty initial checkout without modifying its files or index', () => {
    writeFileSync(join(project, 'source.txt'), 'user edit')
    git(['add', '.'])
    writeFileSync(join(project, 'source.txt'), 'more user edits')
    const index = git(['diff', '--cached'])
    expect(() => prepare('dirty')).toThrow('未提交')
    expect(git(['diff', '--cached'])).toBe(index)
    expect(readFileSync(join(project, 'source.txt'), 'utf8')).toBe('more user edits')
  })

  it('keeps review read-only and rejects mismatched ownership, dirty or unverified delivery', () => {
    const workspace = prepare('turn', 'node')
    writeFileSync(join(workspace.execution.cwd, 'new.txt'), 'output')
    expect(() => reviews.prepareDiffReview({ turnId: 'turn', nodeId: 'node', runId: 'run' })).toThrow('snapshot')
    isolation.executions.snapshot('turn')
    const before = workspaceFingerprint(workspace.execution.cwd)
    const review = reviews.prepareDiffReview({ turnId: 'turn', nodeId: 'node', runId: 'run' })!
    expect(review.files.map(file => file.path)).toContain('new.txt')
    expect(workspaceFingerprint(workspace.execution.cwd)).toBe(before)
    expect(() => reviews.prepareDiffReview({ turnId: 'turn', nodeId: 'other', runId: 'run' })).toThrow('ownership')
    expect(reviews.mergeBranch('turn').error).toContain('approval')
    reviews.setDeliveryVerifier(() => true)
    writeFileSync(join(workspace.execution.cwd, 'new.txt'), 'changed after review')
    expect(reviews.mergeBranch('turn').error).toContain('changed')
    expect(existsSync(join(project, 'new.txt'))).toBe(false)
  })

  it('merges exactly the reviewed head and preserves attempts when closing a review', () => {
    const workspace = prepare('turn', 'node')
    writeFileSync(join(workspace.execution.cwd, 'new.txt'), 'output')
    isolation.executions.snapshot('turn')
    reviews.prepareDiffReview({ turnId: 'turn', nodeId: 'node', runId: 'run' })
    reviews.setDeliveryVerifier(() => true)
    expect(reviews.mergeBranch('turn').success).toBe(true)
    expect(readFileSync(join(project, 'new.txt'), 'utf8')).toBe('output')
    expect(reviews.discardBranch('turn').success).toBe(true)
    expect(isolation.getWorkspace('turn')).toBeDefined()
  })

  it('rejects delivery when the target changed after execution started', () => {
    const workspace = prepare('turn', 'node')
    writeFileSync(join(workspace.execution.cwd, 'new.txt'), 'output')
    isolation.executions.snapshot('turn')
    reviews.prepareDiffReview({ turnId: 'turn', nodeId: 'node', runId: 'run' })
    reviews.setDeliveryVerifier(() => true)
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-qm', 'external change'])
    expect(reviews.mergeBranch('turn').error).toContain('Target branch changed')
    expect(existsSync(join(project, 'new.txt'))).toBe(false)
  })

  it('fingerprints untracked files outside a nested script directory', () => {
    mkdirSync(join(project, 'nested'))
    const before = workspaceFingerprint(join(project, 'nested'))
    writeFileSync(join(project, 'untracked.txt'), 'changed')
    expect(workspaceFingerprint(join(project, 'nested'))).not.toBe(before)
  })
})
