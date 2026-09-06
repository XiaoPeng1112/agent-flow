import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { StorageSQLite } from '../src/services/storage-sqlite.js'
import { DAGScheduler } from '../src/services/dag-scheduler.js'
import { AutoFlowEngine } from '../src/services/auto-flow-engine.js'
import type { Run, TaskNode } from '../src/types/index.js'

const node = (id: string, status: TaskNode['status'] = 'pending'): TaskNode => ({
  id, runId: 'run', name: id, type: 'implement', description: '', status,
  agentRole: 'executor', skillIds: [], artifacts: [], order: 0,
})
const run = (nodes: TaskNode[]): Run => ({
  id: 'run', projectId: 'project', templateId: 'template', name: 'run',
  status: 'running', nodes, edges: [], createdAt: 1,
})

describe('execution contract persistence', () => {
  it('round-trips contracts, inputs, review metadata and turn usage', () => {
    const db = new StorageSQLite(':memory:')
    const task = node('node')
    Object.assign(task, {
      roleStatement: 'Implement the contract', inputs: ['specification'],
      outputContracts: [{ id: 'code', required: true }],
      entryConditions: [{ type: 'artifact_exists', value: 'spec.result' }],
      exitConditions: [{ type: 'test_pass', value: 'npm test' }],
      reviewEnteredAt: 123, rejectCount: 2,
    })
    try {
      db.saveRun(run([task]))
      expect(db.getRun('run')!.nodes[0]).toMatchObject(task)
      db.saveTurn({ id: 'turn', runId: 'run', nodeId: 'node', agentId: 'agent',
        turnIndex: 0, status: 'completed', prompt: '', output: '', startedAt: 1,
        providerExecution: { provider: 'codex', sessionId: 'session_1', resumedFromTurnId: 'previous' },
        toolCalls: ['read_file'], filesModified: 3, tokenUsage: { input: 0, output: 0, total: 0 } })
      expect(db.getTurnsByNode('node')[0]).toMatchObject({
        providerExecution: { provider: 'codex', sessionId: 'session_1', resumedFromTurnId: 'previous' },
        toolCalls: ['read_file'], filesModified: 3, tokenUsage: { input: 0, output: 0, total: 0 },
      })
    } finally { db.close() }
  })

  it('migrates v1 once, backs up data, and flags missing historic contracts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-migration-'))
    const path = join(dir, 'data.db')
    try {
      const first = new StorageSQLite(path)
      first.saveRun(run([node('legacy')]))
      first.close()
      const old = new Database(path)
      for (const table of ['runs', 'nodes', 'turns']) old.exec(`ALTER TABLE ${table} DROP COLUMN metadata_json`)
      old.exec('DELETE FROM schema_version WHERE version = 2')
      old.close()
      const migrated = new StorageSQLite(path)
      expect(migrated.getRun('run')!.nodes[0].requiresContractReview).toBe(true)
      migrated.close()
      const reopened = new StorageSQLite(path)
      expect(reopened.getRun('run')!.nodes[0].id).toBe('legacy')
      reopened.close()
      expect(readdirSync(dir).filter(name => name.endsWith('.bak'))).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('DAG readiness and evidence', () => {
  const scheduler = () => {
    const instance = new DAGScheduler()
    instance.inject({ turnManager: { getTurns: () => [] }, emitter: vi.fn() })
    return instance
  }
  it.each(['pending', 'ready', 'running', 'wait_user_review'] as const)('waits for an upstream %s node before evaluating its branch', status => {
    const graph = run([node('a', status), node('b')])
    graph.edges = [{ source: 'a', target: 'b', condition: { type: 'status', value: 'completed' } }]
    const engine = scheduler()
    engine.computeReadyNodes(graph)
    expect(graph.nodes[1].status).toBe('pending')
    graph.nodes[0].status = 'completed'
    engine.computeReadyNodes(graph)
    expect(graph.nodes[1].status).toBe('ready')
  })
  it('activates an explicit failure recovery branch', () => {
    const graph = run([node('a', 'failed'), node('b')])
    graph.edges = [{ source: 'a', target: 'b', condition: { type: 'status', value: 'failed' } }]
    scheduler().computeReadyNodes(graph)
    expect(graph.nodes[1].status).toBe('ready')
  })
  it('checks root entry conditions and does not execute unsupported expressions', () => {
    const root = node('a')
    root.entryConditions = [{ type: 'expression', value: 'false' }]
    scheduler().computeReadyNodes(run([root]))
    expect(root.status).toBe('failed')
  })
  it('requires a passing verifier for test and lint exit conditions', () => {
    const task = node('a')
    task.exitConditions = [{ type: 'test_pass', value: 'npm test' }]
    const engine = scheduler()
    expect(engine.evaluateExitConditions(run([task]), task).passed).toBe(false)
    engine.setExitVerifier(() => true)
    expect(engine.evaluateExitConditions(run([task]), task).passed).toBe(true)
  })
})

describe('AutoFlow hard gates', () => {
  function fixture() {
    const engine = new AutoFlowEngine()
    const graph = run([node('task', 'running')])
    graph.config = { autoFlow: { enabled: true, confidenceThreshold: 75, neverReviewNodes: ['implement'] } }
    const validation = { passed: true, strategy: 'script', score: 1, details: [], summary: 'passed' }
    // Inject pure test doubles without starting background persistence or reading user data.
    Object.assign(engine, {
      workflowEngine: { getRun: () => graph, getRunConfig: () => graph.config,
        getNodeTurns: () => [], evaluateExitConditions: () => ({ passed: true }) },
      validationTurnService: { getValidationResult: () => validation, validate: vi.fn(async () => validation) },
    })
    const perfect = { contractSatisfaction: 1, exitConditionsPassed: 1, historicalPassRate: 1,
      outputQuality: 1, executionStability: 1, mergeConflictFree: 1 }
    vi.spyOn(engine as any, 'collectSignalsSafe').mockReturnValue(perfect)
    return { engine, graph, validation, perfect }
  }
  it('requires review on cold start even when the confidence reaches 100', () => {
    const { engine } = fixture()
    expect(engine.evaluateAndDecide('run', 'task')).toBe('waiting_user_review')
    expect(engine.getLastEvaluation('run', 'task')!.reasoning).toContain('冷启动')
  })
  it('does not let a perfect confidence override failed verification', async () => {
    const { engine, validation } = fixture()
    validation.passed = false
    validation.score = 0
    expect(await engine.evaluateAndDecideAsync('run', 'task')).toBe('waiting_user_review')
  })
  it('requires review on validation errors', async () => {
    const { engine } = fixture()
    ;(engine as any).validationTurnService.validate.mockRejectedValue(new Error('verification unavailable'))
    expect(await engine.evaluateAndDecideAsync('run', 'task')).toBe('waiting_user_review')
  })
  it('blocks missing legacy contracts even outside cold start', () => {
    const { engine, graph } = fixture()
    graph.nodes[0].requiresContractReview = true
    expect(engine.evaluateAndDecide('run', 'task')).toBe('waiting_user_review')
    expect(engine.getLastEvaluation('run', 'task')!.reasoning).toContain('旧版节点')
  })
  it('bounds learned scores to 100', () => {
    const { engine, perfect } = fixture()
    ;(engine as any).signalPerformance.set('validationScore', { weightMultiplier: 1.3 })
    ;(engine as any).signalPerformance.set('adversarialScore', { weightMultiplier: 1.3 })
    expect((engine as any).computeConfidence({ ...perfect, validationScore: 1, adversarialScore: 1 })).toBe(100)
  })
  it('still approves verified work after the cold-start reviews', () => {
    const { engine } = fixture()
    ;(engine as any).coldStartCounters.set('template:0', 3)
    expect(engine.evaluateAndDecide('run', 'task')).toBe('completed')
  })
})
