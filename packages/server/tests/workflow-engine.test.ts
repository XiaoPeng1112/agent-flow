import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../src/services/workflow-engine.js'
import type { WorkflowTemplate } from '../src/types/index.js'

const mockStorageState = {
  runs: [] as any[],
  turns: new Map<string, any[]>(),
}

// Mock StorageSQLite 为内存模式
vi.mock('../src/services/storage-sqlite.js', () => {
  return {
    StorageSQLite: class MockStorageSQLite {
      getAllRuns() { return mockStorageState.runs }
      getAllTurns() { return mockStorageState.turns }
      getStats() { return { runs: 0, nodes: 0, turns: 0, artifacts: 0, dbSizeKB: 0 } }
      saveAll(runs: any[], turnsMap: Map<string, any[]>) {
        const runMap = new Map(mockStorageState.runs.map(run => [run.id, run]))
        for (const run of runs) {
          runMap.set(run.id, run)
        }
        mockStorageState.runs = Array.from(runMap.values())

        for (const [nodeId, turns] of turnsMap) {
          mockStorageState.turns.set(nodeId, turns)
        }
      }
      deleteRun(runId: string) {
        const run = mockStorageState.runs.find(item => item.id === runId)
        if (!run) return false

        mockStorageState.runs = mockStorageState.runs.filter(item => item.id !== runId)
        for (const node of run.nodes) {
          mockStorageState.turns.delete(node.id)
        }
        return true
      }
      async migrateFromJson() { return { runs: 0, turns: 0 } }
    },
  }
})

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine

  const mockTemplate: WorkflowTemplate = {
    id: 'tpl_test',
    name: 'Test Template',
    description: 'A test workflow template',
    nodes: [
      { id: 'n1', name: 'Specify', type: 'specify', description: 'Requirements', agentRole: 'planner', skillIds: [] },
      { id: 'n2', name: 'Implement', type: 'implement', description: 'Coding', agentRole: 'executor', skillIds: [] },
      { id: 'n3', name: 'Review', type: 'review', description: 'Code review', agentRole: 'manager', skillIds: [] },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
    ],
  }

  beforeEach(async () => {
    mockStorageState.runs = []
    mockStorageState.turns = new Map()
    engine = new WorkflowEngine()
    await engine.load()
  })

  describe('createRun', () => {
    it('should create a run from a template', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)

      expect(run.id).toMatch(/^run_/)
      expect(run.projectId).toBe('proj_1')
      expect(run.templateId).toBe('tpl_test')
      expect(run.status).toBe('created')
      expect(run.nodes).toHaveLength(3)
      expect(run.edges).toHaveLength(2)
    })

    it('should set root node (no predecessors) to ready', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)

      const rootNode = run.nodes.find(n => n.name === 'Specify')
      expect(rootNode?.status).toBe('ready')

      const implNode = run.nodes.find(n => n.name === 'Implement')
      const reviewNode = run.nodes.find(n => n.name === 'Review')
      expect(implNode?.status).toBe('pending')
      expect(reviewNode?.status).toBe('pending')
    })

    it('should use custom name when provided', async () => {
      const run = await engine.createRun('proj_1', mockTemplate, 'Custom Run Name')
      expect(run.name).toBe('Custom Run Name')
    })
  })

  describe('startRun', () => {
    it('should transition run status from created to running', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const started = await engine.startRun(run.id)

      expect(started.status).toBe('running')
      expect(started.startedAt).toBeDefined()
    })

    it('should throw if run is not in created state', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      await engine.startRun(run.id)

      await expect(engine.startRun(run.id)).rejects.toThrow("is not in 'created' state")
    })

    it('should throw for non-existent run', async () => {
      await expect(engine.startRun('run_nonexist')).rejects.toThrow('Run not found')
    })
  })

  describe('startNode', () => {
    it('enforces capacity for manual and automatic claims at the same state transition', async () => {
      const template = { ...mockTemplate, edges: [] }
      const run = await engine.createRun('proj_1', template)
      await engine.updateRunConfig(run.id, { maxParallel: 1 })
      await engine.startNode(run.id, run.nodes[0].id)
      await expect(engine.startNode(run.id, run.nodes[1].id)).rejects.toThrow('parallel execution limit')
      await engine.submitNodeDecision(run.id, run.nodes[0].id, 'waiting_user_review')
      await expect(engine.startNode(run.id, run.nodes[1].id)).resolves.toMatchObject({ status: 'running' })
    })

    it('rejects invalid concurrency limits', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      for (const limit of [0, -1, 1.5, Infinity, 1000]) {
        await expect(engine.updateRunConfig(run.id, { maxParallel: limit })).rejects.toThrow('maxParallel')
      }
    })
    it('should transition ready node to running', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const readyNode = run.nodes.find(n => n.status === 'ready')!

      const started = await engine.startNode(run.id, readyNode.id)
      expect(started.status).toBe('running')
      expect(started.startedAt).toBeDefined()
    })

    it('should auto-start run if still in created state', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const readyNode = run.nodes.find(n => n.status === 'ready')!

      await engine.startNode(run.id, readyNode.id)
      const updatedRun = engine.getRun(run.id)
      expect(updatedRun?.status).toBe('running')
    })

    it('should throw if node is not ready', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const pendingNode = run.nodes.find(n => n.status === 'pending')!

      await expect(engine.startNode(run.id, pendingNode.id)).rejects.toThrow('is not ready')
    })
  })

  describe('submitNodeDecision', () => {
    it('moves finished execution to review when mandatory checks are missing', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes[0]
      node.exitConditions = [{ type: 'test_pass', value: 'npm test' }]
      await engine.startNode(run.id, node.id)
      await engine.submitNodeDecision(run.id, node.id, 'completed')
      expect(node.status).toBe('wait_user_review')
      await expect(engine.approveNode(run.id, node.id)).rejects.toThrow('无法批准')
      engine.setExitVerifier(() => true)
      await expect(engine.approveNode(run.id, node.id)).resolves.toMatchObject({ status: 'completed' })
    })
    it('should mark node as wait_user_review', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const readyNode = run.nodes.find(n => n.status === 'ready')!
      await engine.startNode(run.id, readyNode.id)

      const result = await engine.submitNodeDecision(run.id, readyNode.id, 'waiting_user_review')
      expect(result.status).toBe('wait_user_review')
    })

    it('should mark node as completed and trigger downstream ready', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const specifyNode = run.nodes.find(n => n.name === 'Specify')!
      await engine.startNode(run.id, specifyNode.id)

      await engine.submitNodeDecision(run.id, specifyNode.id, 'completed')

      const updatedRun = engine.getRun(run.id)!
      const implNode = updatedRun.nodes.find(n => n.name === 'Implement')
      expect(implNode?.status).toBe('ready')
    })

    it('should mark node as failed with error message', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const readyNode = run.nodes.find(n => n.status === 'ready')!
      await engine.startNode(run.id, readyNode.id)

      const result = await engine.submitNodeDecision(run.id, readyNode.id, 'failed', 'Something went wrong')
      expect(result.status).toBe('failed')
      expect(result.error).toBe('Something went wrong')
    })
  })

  describe('approveNode / rejectNode', () => {
    it('should approve a wait_user_review node to completed', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes.find(n => n.status === 'ready')!
      await engine.startNode(run.id, node.id)
      await engine.submitNodeDecision(run.id, node.id, 'waiting_user_review')

      const approved = await engine.approveNode(run.id, node.id)
      expect(approved.status).toBe('completed')
    })

    it('should reject a node back to running', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes.find(n => n.status === 'ready')!
      await engine.startNode(run.id, node.id)
      await engine.submitNodeDecision(run.id, node.id, 'waiting_user_review')

      const rejected = await engine.rejectNode(run.id, node.id, 'Needs more work')
      expect(rejected.status).toBe('ready')
      expect(rejected.userInput).toBe('Needs more work')
    })
  })

  describe('skipNode', () => {
    it('should skip a node and trigger downstream ready', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const specifyNode = run.nodes.find(n => n.name === 'Specify')!

      await engine.skipNode(run.id, specifyNode.id)
      expect(specifyNode.status).toBe('skipped')

      const updatedRun = engine.getRun(run.id)!
      const implNode = updatedRun.nodes.find(n => n.name === 'Implement')
      expect(implNode?.status).toBe('ready')
    })
  })

  describe('rollbackNode', () => {
    it('should rollback a node and reset all downstream nodes', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      await engine.startRun(run.id)

      // Complete first two nodes
      const n1 = run.nodes.find(n => n.name === 'Specify')!
      await engine.startNode(run.id, n1.id)
      await engine.submitNodeDecision(run.id, n1.id, 'completed')

      const updatedRun = engine.getRun(run.id)!
      const n2 = updatedRun.nodes.find(n => n.name === 'Implement')!
      await engine.startNode(run.id, n2.id)
      await engine.submitNodeDecision(run.id, n2.id, 'completed')

      // Rollback n1 should reset n2 and n3
      await engine.rollbackNode(run.id, n1.id)

      const finalRun = engine.getRun(run.id)!
      const finalN1 = finalRun.nodes.find(n => n.name === 'Specify')!
      const finalN2 = finalRun.nodes.find(n => n.name === 'Implement')!
      const finalN3 = finalRun.nodes.find(n => n.name === 'Review')!

      // n1 is reset to pending, then computeReadyNodes makes it ready (no predecessors)
      expect(finalN1.status).toBe('ready')
      expect(finalN2.status).toBe('pending')
      expect(finalN3.status).toBe('pending')
    })
  })

  describe('forceResetNode', () => {
    it('should reset a running node to ready', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes.find(n => n.status === 'ready')!
      await engine.startNode(run.id, node.id)

      const reset = await engine.forceResetNode(run.id, node.id)
      expect(reset.status).toBe('ready')
    })

    it('should throw for non-running/failed nodes', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const pendingNode = run.nodes.find(n => n.status === 'pending')!

      await expect(engine.forceResetNode(run.id, pendingNode.id)).rejects.toThrow('is not in running/failed state')
    })
  })

  describe('run completion', () => {
    it('should mark run as completed when all nodes are done', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      await engine.startRun(run.id)

      // Process all nodes to completion
      let updatedRun = engine.getRun(run.id)!
      while (updatedRun.status !== 'completed') {
        const readyNodes = updatedRun.nodes.filter(n => n.status === 'ready')
        if (readyNodes.length === 0) break
        for (const node of readyNodes) {
          await engine.startNode(run.id, node.id)
          await engine.submitNodeDecision(run.id, node.id, 'completed')
        }
        updatedRun = engine.getRun(run.id)!
      }

      expect(updatedRun.status).toBe('completed')
    })
  })

  describe('AgentTurn management', () => {
    it('should start and finalize a turn', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes.find(n => n.status === 'ready')!

      const turn = engine.startTurn(node.id, run.id, 'agent_1', 'Do something')
      expect(turn.id).toMatch(/^turn_/)
      expect(turn.status).toBe('running')
      expect(turn.turnIndex).toBe(0)

      engine.appendTurnOutput(turn.id, node.id, 'Working...')
      engine.recordTurnResult(turn.id, node.id, 'succeeded')
      const finalized = engine.finalizeTurn(turn.id, node.id)

      expect(finalized.status).toBe('completed')
      expect(finalized.output).toBe('Working...')
    })

    it('should handle paused turn (question)', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes.find(n => n.status === 'ready')!

      const turn = engine.startTurn(node.id, run.id, 'agent_1', 'Do something')
      engine.recordTurnResult(turn.id, node.id, 'paused_for_question', 'What framework?')
      const finalized = engine.finalizeTurn(turn.id, node.id)

      expect(finalized.status).toBe('paused')
      expect(finalized.question).toBe('What framework?')
    })

    it('should track multiple turns per node', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes.find(n => n.status === 'ready')!

      const turn1 = engine.startTurn(node.id, run.id, 'agent_1', 'First')
      engine.recordTurnResult(turn1.id, node.id, 'succeeded')
      engine.finalizeTurn(turn1.id, node.id)

      const turn2 = engine.startTurn(node.id, run.id, 'agent_1', 'Second')
      expect(turn2.turnIndex).toBe(1)

      const turns = engine.getNodeTurns(node.id)
      expect(turns).toHaveLength(2)
    })
  })

  describe('topologicalSort', () => {
    it('should return nodes in correct topological order', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const sorted = engine.topologicalSort(run)

      expect(sorted).toHaveLength(3)
      const n1Idx = sorted.findIndex(id => id.includes('n1'))
      const n2Idx = sorted.findIndex(id => id.includes('n2'))
      const n3Idx = sorted.findIndex(id => id.includes('n3'))

      expect(n1Idx).toBeLessThan(n2Idx)
      expect(n2Idx).toBeLessThan(n3Idx)
    })
  })

  describe('getRuns / deleteRun', () => {
    it('should filter runs by projectId', async () => {
      await engine.createRun('proj_1', mockTemplate)
      await engine.createRun('proj_2', mockTemplate)
      await engine.createRun('proj_1', mockTemplate)

      expect(engine.getRuns('proj_1')).toHaveLength(2)
      expect(engine.getRuns()).toHaveLength(3)
    })

    it('should delete a run', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      expect(await engine.deleteRun(run.id)).toBe(true)
      expect(engine.getRun(run.id)).toBeUndefined()
    })

    it('should keep deleted runs removed after reload', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      const node = run.nodes[0]

      const turn = engine.startTurn(node.id, run.id, 'agent_1', 'Delete me')
      engine.recordTurnResult(turn.id, node.id, 'succeeded')
      engine.finalizeTurn(turn.id, node.id)

      await engine.deleteRun(run.id)

      const reloadedEngine = new WorkflowEngine()
      await reloadedEngine.load()

      expect(reloadedEngine.getRun(run.id)).toBeUndefined()
      expect(reloadedEngine.getRuns('proj_1')).toHaveLength(0)
      expect(reloadedEngine.getAllTurns().size).toBe(0)
    })

    it('should remove deleted run from project-scoped results', async () => {
      const run = await engine.createRun('proj_1', mockTemplate)
      await engine.createRun('proj_1', mockTemplate)

      await engine.deleteRun(run.id)

      expect(engine.getRuns('proj_1')).toHaveLength(1)
    })

    it('should return false for non-existent run', async () => {
      expect(await engine.deleteRun('run_nonexist')).toBe(false)
    })
  })
})
