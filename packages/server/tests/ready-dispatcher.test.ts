import { describe, expect, it, vi } from 'vitest'
import { ReadyDispatcher } from '../src/services/ready-dispatcher.js'
import type { Run } from '../src/types/index.js'

function fixture() {
  const run = { id: 'run', status: 'running', config: { maxParallel: 1, autoExecute: true },
    nodes: ['a', 'b', 'c'].map(id => ({ id, status: 'ready' })) } as Run
  const execute = vi.fn(async () => {})
  const dispatcher = new ReadyDispatcher({ getRun: () => run,
    startNode: async (_, id) => { run.nodes.find(n => n.id === id)!.status = 'running' }, execute,
    fail: async (_, id) => { run.nodes.find(n => n.id === id)!.status = 'failed' } })
  return { run, execute, dispatcher }
}
describe('ReadyDispatcher', () => {
  it('serializes concurrent notifications while preparation is awaiting', async () => {
    const { run, execute, dispatcher } = fixture()
    let release!: () => void
    execute.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const first = dispatcher.request('run')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const second = dispatcher.request('run')
    expect(run.nodes.filter(n => n.status === 'running')).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('fills a released slot from persisted ready state', async () => {
    const { run, execute, dispatcher } = fixture()
    await dispatcher.request('run')
    run.nodes[0].status = 'completed'
    await dispatcher.request('run')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(run.nodes[1].status).toBe('running')
  })
  it('releases a failed preparation and starts the next node', async () => {
    const { run, execute, dispatcher } = fixture()
    execute.mockRejectedValueOnce(new Error('CLI unavailable'))
    await dispatcher.request('run')
    expect(run.nodes[0].status).toBe('failed')
    expect(run.nodes[1].status).toBe('running')
  })
  it('does not claim nodes on paused runs', async () => {
    const { run, execute, dispatcher } = fixture()
    run.status = 'paused'
    await dispatcher.request('run')
    expect(execute).not.toHaveBeenCalled()
  })
})
