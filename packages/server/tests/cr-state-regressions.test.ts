import { beforeEach, describe, expect, it } from 'vitest'
import { WorkflowEngine } from '../src/services/workflow-engine.js'
import { ValidationTurnService } from '../src/services/validation-turn.js'
import { createValidationRouter } from '../src/routes/validation.js'
import { useAppStore } from '../../client/src/store/appStore.js'
import { loadProjectRuns } from '../../client/src/api/load-project-runs.js'
import { ReplayCursor } from '../../client/src/api/replay-cursor.js'
import type { Run } from '../../client/src/types/index.js'

describe('Validation recovery and client state ordering', () => {
  beforeEach(() => useAppStore.setState({ runs: [], activeTurns: [], runStateVersion: 0, taskLogEntries: [] }))
  const run = (id: string, projectId: string, status = 'ready') => ({ id, projectId, status: 'running', nodes: [{ id: `${id}-node`, status }], edges: [] }) as Run

  it('ignores a REST response older than an applied WebSocket snapshot and preserves replay state', () => {
    const requestedVersion = useAppStore.getState().runStateVersion
    const cursor = new ReplayCursor(); cursor.request()
    const consume = (message: any) => cursor.receive(message, () => useAppStore.getState().handleWsMessage(message))
    consume({ type: 'sync:snapshot', epoch: 'server', sequence: 10, payload: { runs: [run('r', 'p', 'completed')], activeTurns: [] } })
    consume({ type: 'sync:ready', epoch: 'server', sequence: 10 })
    useAppStore.getState().mergeProjectRuns('p', [run('r', 'p')], requestedVersion)
    consume({ type: 'run:node_updated', epoch: 'server', sequence: 10, payload: { runId: 'r', nodeId: 'r-node', status: 'completed' } })
    expect(useAppStore.getState().runs[0].nodes[0].status).toBe('completed')
  })

  it('merges a project list without deleting other projects and ignores responses older than deletion', () => {
    useAppStore.getState().setRuns([run('a', 'first'), run('b', 'second')])
    const version = useAppStore.getState().runStateVersion
    useAppStore.getState().mergeProjectRuns('first', [run('c', 'first')], version)
    expect(useAppStore.getState().runs.map(r => r.id).sort()).toEqual(['b', 'c'])
    const oldVersion = useAppStore.getState().runStateVersion
    useAppStore.getState().handleWsMessage({ type: 'run:deleted', payload: { runId: 'c' } })
    useAppStore.getState().mergeProjectRuns('first', [run('c', 'first')], oldVersion)
    expect(useAppStore.getState().runs.map(r => r.id)).toEqual(['b'])
  })

  it('reloads a discarded response after another project changes', async () => {
    let requests = 0
    await loadProjectRuns(async () => {
      requests++
      if (requests === 1) useAppStore.getState().addRun(run('other', 'second'))
      return { runs: [run('target', 'first')] }
    }, () => useAppStore.getState().runStateVersion,
    (runs, version) => useAppStore.getState().mergeProjectRuns('first', runs, version), () => false)
    expect(requests).toBe(2)
    expect(useAppStore.getState().runs.map(r => r.id).sort()).toEqual(['other', 'target'])
  })

  it('reports an unstable snapshot instead of treating it as a missing task', async () => {
    let requests = 0
    await expect(loadProjectRuns(async () => {
      requests++
      useAppStore.getState().addRun(run('other', 'second'))
      return { runs: [] }
    }, () => useAppStore.getState().runStateVersion,
    (runs, version) => useAppStore.getState().mergeProjectRuns('first', runs, version), () => false)).rejects.toThrow('任务状态持续更新')
    expect(requests).toBe(3)
  })

  it('applies rollback state and complete node payloads to every connected client', () => {
    useAppStore.getState().setRuns([run('r', 'p', 'completed')])
    const restored = run('r', 'p')
    useAppStore.getState().handleWsMessage({ type: 'run:status_changed', payload: { runId: 'r', status: 'running', run: restored } })
    useAppStore.getState().handleWsMessage({ type: 'run:node_updated', payload: { runId: 'r', nodeId: 'r-node', status: 'failed',
      node: { ...restored.nodes[0], status: 'failed', error: 'specific failure' } } })
    expect(useAppStore.getState().runs[0].nodes[0].error).toBe('specific failure')
  })

  it('lists unverified nodes after restart and allows verification followed by approval', async () => {
    const engine = new WorkflowEngine(':memory:')
    const run = await engine.createRun('project', { id: 't', name: 't', description: '', nodes: ['a', 'b'].map(id => ({ id,
      name: id, description: '', type: 'specify', agentRole: 'executor', skillIds: [] })), edges: [] })
    const node = run.nodes[0]
    await engine.startNode(run.id, node.id)
    const turn = engine.startTurn(node.id, run.id, 'agent', 'write specification')
    engine.appendTurnOutput(turn.id, node.id, 'A complete specification with goals, constraints and acceptance criteria. '.repeat(30))
    engine.recordTurnResult(turn.id, node.id, 'succeeded'); engine.finalizeTurn(turn.id, node.id)
    await engine.submitNodeDecision(run.id, node.id, 'waiting_user_review')
    // A fresh service has the same empty evidence cache as a server restart.
    const validation = new ValidationTurnService()
    validation.inject({ workflowEngine: engine, contractValidator: {} as never, feedbackCollector: { recordValidationFailure() {} } as never,
      robustnessService: { audit() {} } as never })
    engine.setCompletionVerifier((r, n) => ({ passed: validation.getValidationResult(r.id, n.id)?.passed === true }))
    const router = createValidationRouter({ workflowEngine: engine, validationTurnService: validation })
    const call = async (path: string, method: string) => {
      let response: any
      const layer = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]) as any
      await layer.route.stack[0].handle({ params: { runId: run.id, nodeId: node.id } }, {
        json(value: unknown) { response = value }, status() { return this },
      })
      return response.data
    }
    const before = await call('/:runId', 'get')
    expect(before.results).toHaveLength(2)
    expect(before.results.every((row: any) => row.result === null)).toBe(true)
    expect(before.summary.totalValidated).toBe(0)
    await expect(engine.approveNode(run.id, node.id)).rejects.toThrow()
    expect((await call('/:runId/:nodeId/trigger', 'post')).result.passed).toBe(true)
    expect((await call('/:runId', 'get')).summary.totalValidated).toBe(1)
    await engine.approveNode(run.id, node.id)
    expect(node.status).toBe('completed')
  })
})
