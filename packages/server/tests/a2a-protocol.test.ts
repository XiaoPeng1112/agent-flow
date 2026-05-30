import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { A2AProtocolService } from '../src/services/a2a-protocol.js'
import { WorkflowEngine } from '../src/services/workflow-engine.js'

// Mock fs 操作
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('No file')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

describe('A2AProtocolService', () => {
  let a2a: A2AProtocolService
  let engine: WorkflowEngine

  beforeEach(async () => {
    engine = new WorkflowEngine()
    await engine.load()
    a2a = new A2AProtocolService(engine)
  })

  afterEach(() => {
    a2a.dispose()
  })

  describe('send', () => {
    it('should create a queued message', () => {
      const msg = a2a.send({
        fromAgentId: 'agent_manager',
        toAgentId: 'agent_executor',
        runId: 'run_1',
        nodeId: 'node_1',
        type: 'delegated_task',
        payload: { title: 'Implement feature', intent: 'Write code' },
      })

      expect(msg.id).toMatch(/^a2a_/)
      expect(msg.status).toBe('queued')
      expect(msg.fromAgentId).toBe('agent_manager')
      expect(msg.toAgentId).toBe('agent_executor')
      expect(msg.priority).toBe('normal')
      expect(msg.requiresAck).toBe(false)
    })

    it('should set custom priority and requiresAck', () => {
      const msg = a2a.send({
        fromAgentId: 'agent_a',
        toAgentId: 'agent_b',
        runId: 'run_1',
        nodeId: 'node_1',
        type: 'coordination',
        payload: {},
        priority: 'critical',
        requiresAck: true,
      })

      expect(msg.priority).toBe('critical')
      expect(msg.requiresAck).toBe(true)
    })

    it('should set expiration based on ttlMs', () => {
      const before = Date.now()
      const msg = a2a.send({
        fromAgentId: 'a',
        toAgentId: 'b',
        runId: 'run_1',
        nodeId: 'node_1',
        type: 'progress_report',
        payload: {},
        ttlMs: 5000,
      })

      expect(msg.expiresAt).toBeGreaterThanOrEqual(before + 5000)
      expect(msg.expiresAt).toBeLessThanOrEqual(Date.now() + 5000)
    })
  })

  describe('delegateTask', () => {
    it('should send a delegated_task with requiresAck', () => {
      const msg = a2a.delegateTask({
        fromAgentId: 'manager',
        toAgentId: 'executor',
        runId: 'run_1',
        nodeId: 'node_1',
        task: { title: 'Build API', intent: 'Implement REST endpoints' },
      })

      expect(msg.type).toBe('delegated_task')
      expect(msg.requiresAck).toBe(true)
      expect((msg.payload as any).title).toBe('Build API')
    })
  })

  describe('deliverTask', () => {
    it('should send a task_delivery with requiresAck', () => {
      const msg = a2a.deliverTask({
        fromAgentId: 'executor',
        toAgentId: 'manager',
        runId: 'run_1',
        nodeId: 'node_1',
        delivery: { taskId: 'task_1', summary: 'Done', artifacts: [] },
      })

      expect(msg.type).toBe('task_delivery')
      expect(msg.requiresAck).toBe(true)
    })
  })

  describe('reportProgress', () => {
    it('should send a low priority progress report without ack', () => {
      const msg = a2a.reportProgress({
        fromAgentId: 'executor',
        toAgentId: 'manager',
        runId: 'run_1',
        nodeId: 'node_1',
        progress: { percentage: 50, message: 'Half done' },
      })

      expect(msg.type).toBe('progress_report')
      expect(msg.priority).toBe('low')
      expect(msg.requiresAck).toBe(false)
    })
  })

  describe('getInbox', () => {
    it('should return messages sorted by priority', () => {
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: { idx: 1 }, priority: 'low',
      })
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: { idx: 2 }, priority: 'critical',
      })
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: { idx: 3 }, priority: 'normal',
      })

      const inbox = a2a.getInbox('target')
      expect(inbox).toHaveLength(3)
      expect(inbox[0].priority).toBe('critical')
      expect(inbox[1].priority).toBe('normal')
      expect(inbox[2].priority).toBe('low')
    })

    it('should filter by status', () => {
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: {},
      })
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: {},
      })

      // Pull one (changes status to delivered)
      a2a.pullNext('target')

      const queued = a2a.getInbox('target', { status: 'queued' })
      expect(queued).toHaveLength(1)

      const delivered = a2a.getInbox('target', { status: 'delivered' })
      expect(delivered).toHaveLength(1)
    })

    it('should filter by type', () => {
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: {},
      })
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'progress_report', payload: {},
      })

      const coordMsgs = a2a.getInbox('target', { type: 'coordination' })
      expect(coordMsgs).toHaveLength(1)
    })
  })

  describe('pullNext', () => {
    it('should pull the highest priority queued message', () => {
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: { first: true }, priority: 'normal',
      })
      a2a.send({
        fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1',
        type: 'coordination', payload: { second: true }, priority: 'high',
      })

      const msg = a2a.pullNext('target')
      expect(msg).toBeDefined()
      expect(msg!.priority).toBe('high')
      expect(msg!.status).toBe('delivered')
      expect(msg!.deliveredAt).toBeDefined()
    })

    it('should return undefined when inbox is empty', () => {
      const msg = a2a.pullNext('nobody')
      expect(msg).toBeUndefined()
    })
  })

  describe('acknowledge / resolve / fail', () => {
    it('should acknowledge a message', () => {
      const msg = a2a.send({
        fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1',
        type: 'delegated_task', payload: {}, requiresAck: true,
      })

      const acked = a2a.acknowledge(msg.id)
      expect(acked).toBe(true)

      const updated = a2a.getMessage(msg.id)
      expect(updated?.status).toBe('processing')
      expect(updated?.ackAt).toBeDefined()
    })

    it('should resolve a message', () => {
      const msg = a2a.send({
        fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1',
        type: 'delegated_task', payload: {},
      })

      const resolved = a2a.resolve(msg.id, { success: true })
      expect(resolved).toBe(true)

      const updated = a2a.getMessage(msg.id)
      expect(updated?.status).toBe('resolved')
      expect(updated?.resolvedAt).toBeDefined()
    })

    it('should requeue on failure if retries remain', () => {
      const msg = a2a.send({
        fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1',
        type: 'delegated_task', payload: {},
      })

      a2a.fail(msg.id, 'Timeout')
      const updated = a2a.getMessage(msg.id)
      expect(updated?.status).toBe('queued')
      expect(updated?.retryCount).toBe(1)
    })

    it('should mark as failed after max retries', () => {
      const msg = a2a.send({
        fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1',
        type: 'delegated_task', payload: {},
      })

      // Exhaust all retries (maxRetries = 3)
      a2a.fail(msg.id, 'Error 1')
      a2a.fail(msg.id, 'Error 2')
      a2a.fail(msg.id, 'Error 3')

      const updated = a2a.getMessage(msg.id)
      expect(updated?.status).toBe('failed')
      expect(updated?.retryCount).toBe(3)
    })

    it('should return false for non-existent message', () => {
      expect(a2a.acknowledge('nonexist')).toBe(false)
      expect(a2a.resolve('nonexist')).toBe(false)
      expect(a2a.fail('nonexist')).toBe(false)
    })
  })

  describe('channels', () => {
    it('should create a communication channel', () => {
      const channel = a2a.createChannel('run_1', ['agent_a', 'agent_b', 'agent_c'])

      expect(channel.id).toMatch(/^ch_/)
      expect(channel.runId).toBe('run_1')
      expect(channel.participants).toHaveLength(3)
    })

    it('should get channels by runId', () => {
      a2a.createChannel('run_1', ['a', 'b'])
      a2a.createChannel('run_1', ['c', 'd'])
      a2a.createChannel('run_2', ['e', 'f'])

      const run1Channels = a2a.getChannels('run_1')
      expect(run1Channels).toHaveLength(2)
    })

    it('should get channels by agent participation', () => {
      a2a.createChannel('run_1', ['agent_a', 'agent_b'])
      a2a.createChannel('run_1', ['agent_b', 'agent_c'])
      a2a.createChannel('run_2', ['agent_d'])

      const agentBChannels = a2a.getAgentChannels('agent_b')
      expect(agentBChannels).toHaveLength(2)
    })
  })

  describe('broadcast', () => {
    it('should send message to all participants except sender', () => {
      const channel = a2a.createChannel('run_1', ['agent_a', 'agent_b', 'agent_c'])

      const messages = a2a.broadcast(channel.id, {
        fromAgentId: 'agent_a',
        runId: 'run_1',
        nodeId: 'node_1',
        type: 'coordination',
        payload: { announcement: 'Starting work' },
      })

      expect(messages).toHaveLength(2) // agent_b and agent_c
      expect(messages.every(m => m.fromAgentId === 'agent_a')).toBe(true)
      expect(messages.map(m => m.toAgentId).sort()).toEqual(['agent_b', 'agent_c'])
    })

    it('should throw for non-existent channel', () => {
      expect(() => {
        a2a.broadcast('ch_nonexist', {
          fromAgentId: 'a',
          runId: 'r1',
          nodeId: 'n1',
          type: 'coordination',
          payload: {},
        })
      }).toThrow('Channel not found')
    })
  })

  describe('stats', () => {
    it('should return correct message statistics', () => {
      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1', type: 'coordination', payload: {} })
      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1', type: 'coordination', payload: {} })
      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r2', nodeId: 'n1', type: 'coordination', payload: {} })

      const allStats = a2a.getStats()
      expect(allStats.total).toBe(3)
      expect(allStats.queued).toBe(3)

      const r1Stats = a2a.getStats('r1')
      expect(r1Stats.total).toBe(2)
    })
  })

  describe('cleanupRun', () => {
    it('should remove all messages and channels for a run', () => {
      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1', type: 'coordination', payload: {} })
      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1', type: 'coordination', payload: {} })
      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r2', nodeId: 'n1', type: 'coordination', payload: {} })
      a2a.createChannel('r1', ['a', 'b'])

      a2a.cleanupRun('r1')

      expect(a2a.getStats('r1').total).toBe(0)
      expect(a2a.getChannels('r1')).toHaveLength(0)
      expect(a2a.getStats('r2').total).toBe(1) // r2 unaffected
    })
  })

  describe('event system', () => {
    it('should emit message_queued event', () => {
      const handler = vi.fn()
      const unsubscribe = a2a.onEvent(handler)

      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1', type: 'coordination', payload: {} })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message_queued' })
      )
      unsubscribe()
    })

    it('should emit message_delivered on pullNext', () => {
      a2a.send({ fromAgentId: 'a', toAgentId: 'target', runId: 'r1', nodeId: 'n1', type: 'coordination', payload: {} })

      const handler = vi.fn()
      a2a.onEvent(handler)

      a2a.pullNext('target')

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message_delivered' })
      )
    })

    it('should unsubscribe correctly', () => {
      const handler = vi.fn()
      const unsubscribe = a2a.onEvent(handler)
      unsubscribe()

      a2a.send({ fromAgentId: 'a', toAgentId: 'b', runId: 'r1', nodeId: 'n1', type: 'coordination', payload: {} })
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
