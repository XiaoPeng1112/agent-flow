import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DAGScheduler } from '../src/services/dag-scheduler.js'
import type { Run, TaskNode, DAGEdge, AgentTurn } from '../src/types/index.js'

describe('DAGScheduler', () => {
  let scheduler: DAGScheduler
  let mockEmitter: ReturnType<typeof vi.fn>
  let turnsStore: Map<string, AgentTurn[]>

  const makeNode = (id: string, name: string, status: TaskNode['status'] = 'pending'): TaskNode => ({
    id,
    runId: 'run_1',
    name,
    type: 'implement',
    description: `Node ${name}`,
    status,
    agentRole: 'executor',
    skillIds: [],
    artifacts: [],
    order: 0,
  })

  const makeRun = (nodes: TaskNode[], edges: DAGEdge[], status: Run['status'] = 'running'): Run => ({
    id: 'run_1',
    projectId: 'proj_1',
    templateId: 'tpl_1',
    name: 'Test Run',
    status,
    nodes,
    edges,
    createdAt: Date.now(),
  })

  beforeEach(() => {
    scheduler = new DAGScheduler()
    mockEmitter = vi.fn()
    turnsStore = new Map()

    scheduler.inject({
      turnManager: {
        getTurns: (nodeId: string) => turnsStore.get(nodeId) || [],
      },
      emitter: mockEmitter,
    })
  })

  describe('computeReadyNodes', () => {
    it('should mark root nodes (no predecessors) as ready', () => {
      const nodes = [makeNode('n1', 'Root'), makeNode('n2', 'Child')]
      const edges: DAGEdge[] = [{ source: 'n1', target: 'n2' }]
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(nodes[0].status).toBe('ready')
      expect(nodes[1].status).toBe('pending')
    })

    it('should mark child as ready when all predecessors are completed', () => {
      const nodes = [
        makeNode('n1', 'A', 'completed'),
        makeNode('n2', 'B'),
      ]
      const edges: DAGEdge[] = [{ source: 'n1', target: 'n2' }]
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('ready')
    })

    it('should mark child as ready when predecessor is skipped', () => {
      const nodes = [
        makeNode('n1', 'A', 'skipped'),
        makeNode('n2', 'B'),
      ]
      const edges: DAGEdge[] = [{ source: 'n1', target: 'n2' }]
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('ready')
    })

    it('should NOT mark child as ready if predecessor is still running', () => {
      const nodes = [
        makeNode('n1', 'A', 'running'),
        makeNode('n2', 'B'),
      ]
      const edges: DAGEdge[] = [{ source: 'n1', target: 'n2' }]
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('pending')
    })

    it('should handle diamond DAG correctly', () => {
      // n1 → n2, n1 → n3, n2 → n4, n3 → n4
      const nodes = [
        makeNode('n1', 'Start', 'completed'),
        makeNode('n2', 'Left'),
        makeNode('n3', 'Right'),
        makeNode('n4', 'Join'),
      ]
      const edges: DAGEdge[] = [
        { source: 'n1', target: 'n2' },
        { source: 'n1', target: 'n3' },
        { source: 'n2', target: 'n4' },
        { source: 'n3', target: 'n4' },
      ]
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('ready')  // n2 ready
      expect(nodes[2].status).toBe('ready')  // n3 ready
      expect(nodes[3].status).toBe('pending')  // n4 still waiting
    })

    it('should NOT advance nodes when run is paused', () => {
      const nodes = [makeNode('n1', 'Root')]
      const edges: DAGEdge[] = []
      const run = makeRun(nodes, edges, 'paused')

      scheduler.computeReadyNodes(run)

      expect(nodes[0].status).toBe('pending')
    })

    it('should emit run:node_updated events', () => {
      const nodes = [makeNode('n1', 'Root')]
      const edges: DAGEdge[] = []
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(mockEmitter).toHaveBeenCalledWith('run:node_updated', {
        runId: 'run_1',
        nodeId: 'n1',
        status: 'ready',
      })
    })
  })

  describe('conditional edges', () => {
    it('should skip node when all conditional edges fail', () => {
      const nodes = [
        makeNode('n1', 'Source', 'completed'),
        makeNode('n2', 'Target'),
      ]
      const edges: DAGEdge[] = [{
        source: 'n1',
        target: 'n2',
        condition: { type: 'status', value: 'failed' },  // n1 is completed, not failed
      }]
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('skipped')
    })

    it('should make node ready when conditional edge is satisfied', () => {
      const nodes = [
        makeNode('n1', 'Source', 'completed'),
        makeNode('n2', 'Target'),
      ]
      const edges: DAGEdge[] = [{
        source: 'n1',
        target: 'n2',
        condition: { type: 'status', value: 'completed' },
      }]
      const run = makeRun(nodes, edges)

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('ready')
    })

    it('should evaluate output_contains condition', () => {
      const nodes = [
        makeNode('n1', 'Source', 'completed'),
        makeNode('n2', 'Target'),
      ]
      const edges: DAGEdge[] = [{
        source: 'n1',
        target: 'n2',
        condition: { type: 'output_contains', value: 'APPROVED' },
      }]
      const run = makeRun(nodes, edges)

      // Set up turn output containing APPROVED
      turnsStore.set('n1', [{
        id: 'turn_1',
        nodeId: 'n1',
        runId: 'run_1',
        agentId: 'agent_1',
        turnIndex: 0,
        status: 'completed',
        prompt: 'test',
        output: 'Decision: APPROVED by reviewer',
        startedAt: Date.now(),
        completedAt: Date.now(),
      }])

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('ready')
    })

    it('should skip node when output_contains condition fails', () => {
      const nodes = [
        makeNode('n1', 'Source', 'completed'),
        makeNode('n2', 'Target'),
      ]
      const edges: DAGEdge[] = [{
        source: 'n1',
        target: 'n2',
        condition: { type: 'output_contains', value: 'APPROVED' },
      }]
      const run = makeRun(nodes, edges)

      // Set up turn output NOT containing APPROVED
      turnsStore.set('n1', [{
        id: 'turn_1',
        nodeId: 'n1',
        runId: 'run_1',
        agentId: 'agent_1',
        turnIndex: 0,
        status: 'completed',
        prompt: 'test',
        output: 'Decision: REJECTED',
        startedAt: Date.now(),
        completedAt: Date.now(),
      }])

      scheduler.computeReadyNodes(run)

      expect(nodes[1].status).toBe('skipped')
    })
  })

  describe('topologicalSort', () => {
    it('should sort a linear chain', () => {
      const nodes = [makeNode('n1', 'A'), makeNode('n2', 'B'), makeNode('n3', 'C')]
      const edges: DAGEdge[] = [
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' },
      ]
      const run = makeRun(nodes, edges)

      const sorted = scheduler.topologicalSort(run)

      expect(sorted).toEqual(['n1', 'n2', 'n3'])
    })

    it('should handle parallel branches', () => {
      const nodes = [
        makeNode('n1', 'Start'),
        makeNode('n2', 'Left'),
        makeNode('n3', 'Right'),
        makeNode('n4', 'End'),
      ]
      const edges: DAGEdge[] = [
        { source: 'n1', target: 'n2' },
        { source: 'n1', target: 'n3' },
        { source: 'n2', target: 'n4' },
        { source: 'n3', target: 'n4' },
      ]
      const run = makeRun(nodes, edges)

      const sorted = scheduler.topologicalSort(run)

      // n1 must be first, n4 must be last
      expect(sorted[0]).toBe('n1')
      expect(sorted[3]).toBe('n4')
      // n2 and n3 must both come before n4
      expect(sorted.indexOf('n2')).toBeLessThan(sorted.indexOf('n4'))
      expect(sorted.indexOf('n3')).toBeLessThan(sorted.indexOf('n4'))
    })

    it('should handle single node', () => {
      const nodes = [makeNode('n1', 'Solo')]
      const run = makeRun(nodes, [])

      const sorted = scheduler.topologicalSort(run)
      expect(sorted).toEqual(['n1'])
    })
  })

  describe('getDownstreamNodes', () => {
    it('should find all downstream nodes via BFS', () => {
      const nodes = [
        makeNode('n1', 'Start'),
        makeNode('n2', 'Mid'),
        makeNode('n3', 'End'),
      ]
      const edges: DAGEdge[] = [
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' },
      ]
      const run = makeRun(nodes, edges)

      const downstream = scheduler.getDownstreamNodes(run, 'n1')

      expect(downstream).toHaveLength(2)
      expect(downstream.map(n => n.id)).toContain('n2')
      expect(downstream.map(n => n.id)).toContain('n3')
    })

    it('should return empty array for leaf node', () => {
      const nodes = [makeNode('n1', 'Start'), makeNode('n2', 'End')]
      const edges: DAGEdge[] = [{ source: 'n1', target: 'n2' }]
      const run = makeRun(nodes, edges)

      const downstream = scheduler.getDownstreamNodes(run, 'n2')
      expect(downstream).toHaveLength(0)
    })

    it('should handle diamond DAG without duplicates', () => {
      const nodes = [
        makeNode('n1', 'Start'),
        makeNode('n2', 'Left'),
        makeNode('n3', 'Right'),
        makeNode('n4', 'Join'),
      ]
      const edges: DAGEdge[] = [
        { source: 'n1', target: 'n2' },
        { source: 'n1', target: 'n3' },
        { source: 'n2', target: 'n4' },
        { source: 'n3', target: 'n4' },
      ]
      const run = makeRun(nodes, edges)

      const downstream = scheduler.getDownstreamNodes(run, 'n1')

      expect(downstream).toHaveLength(3)
      // n4 should appear only once
      const n4Count = downstream.filter(n => n.id === 'n4').length
      expect(n4Count).toBe(1)
    })
  })
})
