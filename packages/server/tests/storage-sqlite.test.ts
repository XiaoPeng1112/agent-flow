import { describe, it, expect, beforeEach } from 'vitest'
import { StorageSQLite } from '../src/services/storage-sqlite.js'
import type { Run, AgentTurn, TaskNode, DAGEdge } from '../src/types/index.js'

describe('StorageSQLite', () => {
  let storage: StorageSQLite

  const makeRun = (id: string, projectId = 'proj_1'): Run => ({
    id,
    projectId,
    templateId: 'tpl_1',
    name: `Run ${id}`,
    status: 'running',
    nodes: [
      {
        id: `${id}_n1`,
        runId: id,
        name: 'Node 1',
        type: 'implement',
        description: 'Test node',
        status: 'ready',
        agentRole: 'executor',
        skillIds: ['skill_1'],
        artifacts: [],
        order: 0,
      },
      {
        id: `${id}_n2`,
        runId: id,
        name: 'Node 2',
        type: 'review',
        description: 'Review node',
        status: 'pending',
        agentRole: 'manager',
        skillIds: [],
        artifacts: [],
        order: 1,
      },
    ],
    edges: [
      { source: `${id}_n1`, target: `${id}_n2` },
    ],
    createdAt: Date.now(),
  })

  const makeTurn = (nodeId: string, turnIndex = 0): AgentTurn => ({
    id: `turn_${nodeId}_${turnIndex}`,
    nodeId,
    runId: 'run_1',
    agentId: 'agent_1',
    turnIndex,
    status: 'completed',
    prompt: `Prompt ${turnIndex}`,
    output: `Output ${turnIndex}`,
    startedAt: Date.now() - 10000,
    completedAt: Date.now(),
    tokenUsage: { input: 100, output: 50, total: 150 },
  })

  beforeEach(() => {
    // 每个测试使用内存数据库，完全隔离
    storage = new StorageSQLite(':memory:')
  })

  describe('initialization', () => {
    it('should create tables on construction', () => {
      const stats = storage.getStats()
      expect(stats.runs).toBe(0)
      expect(stats.nodes).toBe(0)
      expect(stats.turns).toBe(0)
      expect(stats.artifacts).toBe(0)
    })
  })

  describe('saveAll / getAllRuns', () => {
    it('should save and retrieve runs', () => {
      const run1 = makeRun('run_1')
      const run2 = makeRun('run_2', 'proj_2')

      storage.saveAll([run1, run2], new Map())

      const allRuns = storage.getAllRuns()
      expect(allRuns).toHaveLength(2)
      expect(allRuns[0].id).toBe('run_1')
      expect(allRuns[1].id).toBe('run_2')
    })

    it('should preserve run fields correctly', () => {
      const run = makeRun('run_1')
      run.startedAt = Date.now()

      storage.saveAll([run], new Map())

      const retrieved = storage.getAllRuns()
      expect(retrieved[0].id).toBe('run_1')
      expect(retrieved[0].projectId).toBe('proj_1')
      expect(retrieved[0].templateId).toBe('tpl_1')
      expect(retrieved[0].status).toBe('running')
      expect(retrieved[0].nodes).toHaveLength(2)
      expect(retrieved[0].edges).toHaveLength(1)
    })

    it('should preserve node details', () => {
      const run = makeRun('run_1')
      storage.saveAll([run], new Map())

      const retrieved = storage.getAllRuns()
      const node = retrieved[0].nodes[0]
      expect(node.id).toBe('run_1_n1')
      expect(node.name).toBe('Node 1')
      expect(node.type).toBe('implement')
      expect(node.status).toBe('ready')
      expect(node.agentRole).toBe('executor')
      expect(node.skillIds).toEqual(['skill_1'])
    })

    it('should preserve edge details', () => {
      const run = makeRun('run_1')
      storage.saveAll([run], new Map())

      const retrieved = storage.getAllRuns()
      expect(retrieved[0].edges[0]).toEqual({
        source: 'run_1_n1',
        target: 'run_1_n2',
      })
    })

    it('should filter runs by projectId', () => {
      const run1 = makeRun('run_1', 'proj_a')
      const run2 = makeRun('run_2', 'proj_b')
      const run3 = makeRun('run_3', 'proj_a')

      storage.saveAll([run1, run2, run3], new Map())

      const projA = storage.getAllRuns('proj_a')
      expect(projA).toHaveLength(2)
      expect(projA.every(r => r.projectId === 'proj_a')).toBe(true)
    })

    it('should handle upsert (update existing run)', () => {
      const run = makeRun('run_1')
      storage.saveAll([run], new Map())

      // Update status
      run.status = 'completed'
      run.completedAt = Date.now()
      storage.saveAll([run], new Map())

      const retrieved = storage.getAllRuns()
      expect(retrieved).toHaveLength(1)
      expect(retrieved[0].status).toBe('completed')
    })
  })

  describe('turns', () => {
    // Turns have a FK to nodes, so we need a run with matching node IDs first
    const runWithNodes = (nodeIds: string[]): Run => ({
      id: 'run_1',
      projectId: 'proj_1',
      templateId: 'tpl_1',
      name: 'Host Run',
      status: 'running',
      nodes: nodeIds.map((id, i) => ({
        id,
        runId: 'run_1',
        name: `Node ${id}`,
        type: 'implement' as const,
        description: '',
        status: 'running' as const,
        agentRole: 'executor',
        skillIds: [],
        artifacts: [],
        order: i,
      })),
      edges: [],
      createdAt: Date.now(),
    })

    it('should save and retrieve turns', () => {
      // First save the run so nodes exist for FK
      storage.saveAll([runWithNodes(['node_1', 'node_2'])], new Map())

      const turns = new Map<string, AgentTurn[]>()
      turns.set('node_1', [makeTurn('node_1', 0), makeTurn('node_1', 1)])
      turns.set('node_2', [makeTurn('node_2', 0)])

      storage.saveAll([runWithNodes(['node_1', 'node_2'])], turns)

      const allTurns = storage.getAllTurns()
      expect(allTurns.size).toBe(2)
      expect(allTurns.get('node_1')).toHaveLength(2)
      expect(allTurns.get('node_2')).toHaveLength(1)
    })

    it('should preserve turn fields', () => {
      storage.saveAll([runWithNodes(['node_1'])], new Map())

      const turn = makeTurn('node_1', 0)
      const turns = new Map<string, AgentTurn[]>([['node_1', [turn]]])

      storage.saveAll([runWithNodes(['node_1'])], turns)

      const retrieved = storage.getAllTurns()
      const savedTurn = retrieved.get('node_1')![0]
      expect(savedTurn.id).toBe(turn.id)
      expect(savedTurn.nodeId).toBe('node_1')
      expect(savedTurn.agentId).toBe('agent_1')
      expect(savedTurn.status).toBe('completed')
      expect(savedTurn.prompt).toBe('Prompt 0')
      expect(savedTurn.output).toBe('Output 0')
      expect(savedTurn.tokenUsage).toEqual({ input: 100, output: 50, total: 150 })
    })
  })

  describe('getStats', () => {
    it('should report correct counts', () => {
      const run = makeRun('run_1')
      const turns = new Map<string, AgentTurn[]>([
        ['run_1_n1', [makeTurn('run_1_n1', 0)]],
      ])

      storage.saveAll([run], turns)

      const stats = storage.getStats()
      expect(stats.runs).toBe(1)
      expect(stats.nodes).toBe(2)
      expect(stats.turns).toBe(1)
    })
  })

  describe('combined save', () => {
    it('should save runs and turns together in one transaction', () => {
      const run = makeRun('run_1')
      const turns = new Map<string, AgentTurn[]>([
        ['run_1_n1', [makeTurn('run_1_n1', 0), makeTurn('run_1_n1', 1)]],
        ['run_1_n2', [makeTurn('run_1_n2', 0)]],
      ])

      storage.saveAll([run], turns)

      const stats = storage.getStats()
      expect(stats.runs).toBe(1)
      expect(stats.nodes).toBe(2)
      expect(stats.turns).toBe(3)
    })
  })
})
