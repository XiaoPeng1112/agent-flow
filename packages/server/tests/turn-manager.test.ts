import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TurnManager } from '../src/services/turn-manager.js'
import type { Run } from '../src/types/index.js'

describe('TurnManager', () => {
  let manager: TurnManager
  let mockEmitter: ReturnType<typeof vi.fn>
  let mockPersist: ReturnType<typeof vi.fn>

  beforeEach(() => {
    manager = new TurnManager()
    mockEmitter = vi.fn()
    mockPersist = vi.fn()

    manager.inject({
      emitter: mockEmitter,
      persistFn: mockPersist,
    })
  })

  describe('startTurn', () => {
    it('should create a new turn with correct initial state', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Do the task')

      expect(turn.id).toMatch(/^turn_/)
      expect(turn.nodeId).toBe('node_1')
      expect(turn.runId).toBe('run_1')
      expect(turn.agentId).toBe('agent_1')
      expect(turn.prompt).toBe('Do the task')
      expect(turn.status).toBe('running')
      expect(turn.turnIndex).toBe(0)
      expect(turn.output).toBe('')
      expect(turn.startedAt).toBeGreaterThan(0)
    })

    it('should increment turnIndex for subsequent turns', () => {
      const turn1 = manager.startTurn('node_1', 'run_1', 'agent_1', 'First')
      const turn2 = manager.startTurn('node_1', 'run_1', 'agent_1', 'Second')
      const turn3 = manager.startTurn('node_1', 'run_1', 'agent_1', 'Third')

      expect(turn1.turnIndex).toBe(0)
      expect(turn2.turnIndex).toBe(1)
      expect(turn3.turnIndex).toBe(2)
    })

    it('should emit agent:turn_started event', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')

      expect(mockEmitter).toHaveBeenCalledWith('agent:turn_started', { turn })
    })

    it('should trigger persist', () => {
      manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')

      expect(mockPersist).toHaveBeenCalledTimes(1)
    })
  })

  describe('appendTurnOutput', () => {
    it('should append chunks to turn output', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')

      manager.appendTurnOutput(turn.id, 'node_1', 'Hello ')
      manager.appendTurnOutput(turn.id, 'node_1', 'World')

      const turns = manager.getNodeTurns('node_1')
      expect(turns[0].output).toBe('Hello World')
    })

    it('should emit agent:turn_output for each chunk', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      mockEmitter.mockClear()

      manager.appendTurnOutput(turn.id, 'node_1', 'chunk1')

      expect(mockEmitter).toHaveBeenCalledWith('agent:turn_output', {
        turnId: turn.id,
        nodeId: 'node_1',
        chunk: 'chunk1',
      })
    })

    it('should do nothing if turn not found', () => {
      manager.appendTurnOutput('nonexist', 'node_1', 'data')
      // Should not throw
    })
  })

  describe('recordTurnResult', () => {
    it('should record succeeded result', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')

      const updated = manager.recordTurnResult(turn.id, 'node_1', 'succeeded')

      expect(updated.result).toBe('succeeded')
    })

    it('should record paused_for_question with question', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')

      const updated = manager.recordTurnResult(turn.id, 'node_1', 'paused_for_question', 'What tech stack?')

      expect(updated.result).toBe('paused_for_question')
      expect(updated.question).toBe('What tech stack?')
    })

    it('should record token usage', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')

      const updated = manager.recordTurnResult(turn.id, 'node_1', 'succeeded', undefined, {
        input: 1000,
        output: 500,
        total: 1500,
      })

      expect(updated.tokenUsage).toEqual({ input: 1000, output: 500, total: 1500 })
    })

    it('should throw if turn not found', () => {
      expect(() => manager.recordTurnResult('nonexist', 'node_1', 'succeeded'))
        .toThrow()
    })

    it('should throw if turn is not running', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      manager.recordTurnResult(turn.id, 'node_1', 'succeeded')
      manager.finalizeTurn(turn.id, 'node_1')

      expect(() => manager.recordTurnResult(turn.id, 'node_1', 'succeeded'))
        .toThrow('is not running')
    })
  })

  describe('finalizeTurn', () => {
    it('should finalize succeeded turn as completed', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      manager.recordTurnResult(turn.id, 'node_1', 'succeeded')

      const finalized = manager.finalizeTurn(turn.id, 'node_1')

      expect(finalized.status).toBe('completed')
      expect(finalized.completedAt).toBeGreaterThan(0)
    })

    it('should finalize failed turn as error', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      manager.recordTurnResult(turn.id, 'node_1', 'failed')

      const finalized = manager.finalizeTurn(turn.id, 'node_1')

      expect(finalized.status).toBe('error')
      expect(finalized.completedAt).toBeGreaterThan(0)
    })

    it('should finalize paused_for_question turn as paused', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      manager.recordTurnResult(turn.id, 'node_1', 'paused_for_question', 'Which DB?')

      const finalized = manager.finalizeTurn(turn.id, 'node_1')

      expect(finalized.status).toBe('paused')
      expect(finalized.question).toBe('Which DB?')
    })

    it('should emit appropriate event and persist', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      manager.recordTurnResult(turn.id, 'node_1', 'succeeded')
      mockEmitter.mockClear()
      mockPersist.mockClear()

      manager.finalizeTurn(turn.id, 'node_1')

      expect(mockEmitter).toHaveBeenCalledWith('agent:turn_completed', expect.anything())
      expect(mockPersist).toHaveBeenCalledTimes(1)
    })

    it('should throw for non-existent turn', () => {
      expect(() => manager.finalizeTurn('nonexist', 'node_1')).toThrow()
    })
  })

  describe('getNodeTurns / getActiveTurn', () => {
    it('should return all turns for a node', () => {
      manager.startTurn('node_1', 'run_1', 'agent_1', 'First')
      manager.startTurn('node_1', 'run_1', 'agent_1', 'Second')

      const turns = manager.getNodeTurns('node_1')
      expect(turns).toHaveLength(2)
    })

    it('should return empty array for unknown node', () => {
      expect(manager.getNodeTurns('unknown')).toEqual([])
    })

    it('should find active (running) turn', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Active')

      const active = manager.getActiveTurn('node_1')
      expect(active?.id).toBe(turn.id)
    })

    it('should find paused turn as active', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      manager.recordTurnResult(turn.id, 'node_1', 'paused_for_question', 'Q?')
      manager.finalizeTurn(turn.id, 'node_1')

      const active = manager.getActiveTurn('node_1')
      expect(active?.status).toBe('paused')
    })

    it('should return undefined when no active turn', () => {
      const turn = manager.startTurn('node_1', 'run_1', 'agent_1', 'Prompt')
      manager.recordTurnResult(turn.id, 'node_1', 'succeeded')
      manager.finalizeTurn(turn.id, 'node_1')

      expect(manager.getActiveTurn('node_1')).toBeUndefined()
    })
  })

  describe('setTurns / getAllTurnsMap', () => {
    it('should set turns for a node', () => {
      const mockTurns = [{
        id: 'turn_imported',
        nodeId: 'node_1',
        runId: 'run_1',
        agentId: 'agent_1',
        turnIndex: 0,
        status: 'completed' as const,
        prompt: 'test',
        output: 'result',
        startedAt: Date.now(),
        completedAt: Date.now(),
      }]

      manager.setTurns('node_1', mockTurns)

      expect(manager.getNodeTurns('node_1')).toEqual(mockTurns)
    })

    it('should return the full turns map', () => {
      manager.startTurn('node_1', 'run_1', 'agent_1', 'P1')
      manager.startTurn('node_2', 'run_1', 'agent_1', 'P2')

      const turnsMap = manager.getAllTurnsMap()
      expect(turnsMap.size).toBe(2)
      expect(turnsMap.has('node_1')).toBe(true)
      expect(turnsMap.has('node_2')).toBe(true)
    })
  })

  describe('getRunTokenStats', () => {
    it('should aggregate token usage across nodes', () => {
      const turn1 = manager.startTurn('node_1', 'run_1', 'agent_1', 'P1')
      manager.recordTurnResult(turn1.id, 'node_1', 'succeeded', undefined, {
        input: 1000,
        output: 500,
        total: 1500,
      })
      manager.finalizeTurn(turn1.id, 'node_1')

      const turn2 = manager.startTurn('node_2', 'run_1', 'agent_1', 'P2')
      manager.recordTurnResult(turn2.id, 'node_2', 'succeeded', undefined, {
        input: 2000,
        output: 800,
        total: 2800,
      })
      manager.finalizeTurn(turn2.id, 'node_2')

      const run: Run = {
        id: 'run_1',
        projectId: 'proj_1',
        templateId: 'tpl_1',
        name: 'Test',
        status: 'completed',
        nodes: [
          { id: 'node_1', runId: 'run_1', name: 'N1', type: 'implement', description: '', status: 'completed', agentRole: 'executor', skillIds: [], order: 0 },
          { id: 'node_2', runId: 'run_1', name: 'N2', type: 'review', description: '', status: 'completed', agentRole: 'manager', skillIds: [], order: 1 },
        ],
        edges: [],
        createdAt: Date.now(),
      }

      const stats = manager.getRunTokenStats(run)

      expect(stats.totalInput).toBe(3000)
      expect(stats.totalOutput).toBe(1300)
      expect(stats.totalTokens).toBe(4300)
      expect(stats.byNode).toHaveLength(2)
      expect(stats.estimatedCost).toBeDefined()
      expect(stats.estimatedCost!.usd).toBeGreaterThan(0)
    })

    it('should return zeros when no token data', () => {
      const run: Run = {
        id: 'run_1',
        projectId: 'proj_1',
        templateId: 'tpl_1',
        name: 'Test',
        status: 'completed',
        nodes: [
          { id: 'node_1', runId: 'run_1', name: 'N1', type: 'implement', description: '', status: 'completed', agentRole: 'executor', skillIds: [], order: 0 },
        ],
        edges: [],
        createdAt: Date.now(),
      }

      const stats = manager.getRunTokenStats(run)

      expect(stats.totalTokens).toBe(0)
      expect(stats.byNode).toHaveLength(0)
      expect(stats.estimatedCost).toBeUndefined()
    })
  })
})
