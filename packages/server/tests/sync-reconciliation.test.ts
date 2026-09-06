import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SyncService, type SyncConfig } from '../src/services/sync.js'
import { WorkflowEngine } from '../src/services/workflow-engine.js'

describe('Run synchronization between devices', () => {
  let remote: Map<string, { content: string; sha: string }>, serial: number, root: string
  let beforePut: ((path: string) => void) | undefined
  const template = { id: 'template', name: 'Sync', description: '', nodes: [{ id: 'n', name: 'Node', type: 'review' as const,
    description: '', agentRole: 'executor' as const, skillIds: [] }], edges: [] }
  const runPath = (id: string) => `users/fixture/runs/${id}.json`
  const read = (id: string) => JSON.parse(remote.get(runPath(id))!.content)
  const write = (id: string, value: unknown) => remote.set(runPath(id), { content: JSON.stringify(value), sha: String(++serial) })
  function device(engine = new WorkflowEngine(':memory:'), saved?: SyncConfig) {
    const service = new SyncService({ getAccessToken: () => 'fixture', getCurrentUser: () => ({ login: 'fixture' }), isAuthenticated: () => true } as never,
      { getProjects: () => [] } as never, engine, { getTemplates: () => [] } as never)
    const internal = service as any
    internal.config = saved ? structuredClone(saved) : { repoFullName: 'fixture/data', autoSync: true }
    internal.saveConfig = vi.fn(async () => {})
    internal.pushContextDb = async () => 0
    internal.pullContextDb = async () => 0
    internal.pullSharedResources = async () => 0
    return { engine, service, saved: () => structuredClone(internal.config) as SyncConfig }
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentflow-sync-'))
    remote = new Map(); serial = 0; beforePut = undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      const path = new URL(url).pathname.split('/contents/')[1]
      const method = options?.method || 'GET'
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
      if (method === 'PUT') {
        beforePut?.(path)
        const body = JSON.parse(options!.body as string)
        if (body.sha !== remote.get(path)?.sha) return json({ message: 'concurrent write' }, 409)
        remote.set(path, { content: Buffer.from(body.content, 'base64').toString('utf8'), sha: String(++serial) })
        return json({})
      }
      if (method === 'DELETE') throw new Error('Run synchronization must publish tombstones, never infer deletion')
      const file = remote.get(path)
      if (file) return json({ sha: file.sha, encoding: 'base64', content: Buffer.from(file.content).toString('base64') })
      const children = [...remote.keys()].filter(key => key.startsWith(`${path}/`)).map(key => ({ name: key.slice(path.length + 1), type: 'file' }))
      return children.length ? json(children) : json({}, 404)
    }))
  })
  afterEach(() => { vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true }) })

  it('preserves offline-created runs on both sides through push and pull', async () => {
    const a = device(), b = device()
    const first = await a.engine.createRun('project', template)
    const second = await b.engine.createRun('project', template)
    await a.service.push()
    await b.service.push()
    expect(read(first.id).id).toBe(first.id)
    expect(read(second.id).id).toBe(second.id)
    const unsynced = await a.engine.createRun('project', template)
    expect((await a.service.pull()).conflicts).toEqual([])
    expect(a.engine.getRun(unsynced.id)).toBeDefined()
    expect(a.engine.getRun(second.id)).toBeDefined()
    expect(a.service.getStatus().dirty).toBe(true)
  })

  it('persists explicit deletions across restart and propagates the last run deletion', async () => {
    const database = join(root, 'a.db')
    const a = device(new WorkflowEngine(database)), b = device()
    const run = await a.engine.createRun('project', template)
    await a.service.push(); await b.service.pull()
    await a.engine.deleteRun(run.id)
    const restarted = new WorkflowEngine(database); await restarted.load()
    const next = device(restarted, a.saved())
    expect(next.service.getStatus().dirty).toBe(true)
    await next.service.push()
    expect(read(run.id)._deleted).toBe(true)
    await b.service.pull()
    expect(b.engine.getRuns()).toHaveLength(0)
    expect(b.engine.getRunTombstones()).toHaveLength(1)
    await b.service.push()
    expect(read(run.id)._deleted).toBe(true)
  })

  it('synchronizes node progress and pause with unchanged lifecycle timestamps', async () => {
    const a = device(), b = device()
    const run = await a.engine.createRun('project', template)
    await a.engine.startRun(run.id)
    await a.service.push(); await b.service.pull()
    const startedAt = run.startedAt
    run.nodes[0].userInput = 'updated on A'
    await a.engine.pauseRun(run.id)
    await a.service.push(); await b.service.pull()
    const received = b.engine.getRun(run.id)!
    expect(received.startedAt).toBe(startedAt)
    expect(received.status).toBe('paused')
    expect(received.nodes[0].userInput).toBe('updated on A')
    expect(b.service.getStatus().dirty).toBe(false)
  })

  it('preserves both copies and dirty state on concurrent edits or edit/delete conflicts', async () => {
    const a = device(), b = device()
    const run = await a.engine.createRun('project', template)
    await a.service.push(); await b.service.pull()
    run.nodes[0].userInput = 'remote edit'; await a.engine.persist(); await a.service.push()
    b.engine.getRun(run.id)!.nodes[0].userInput = 'local edit'; await b.engine.persist()
    const pull = await b.service.pull()
    expect(pull.success).toBe(false); expect(pull.conflicts).toHaveLength(1)
    expect(b.engine.getRun(run.id)!.nodes[0].userInput).toBe('local edit')
    await expect(b.service.push()).rejects.toThrow('conflict')
    expect(read(run.id).nodes[0].userInput).toBe('remote edit')
    expect(b.service.getStatus().dirty).toBe(true)
    await a.engine.deleteRun(run.id); await a.service.push()
    expect((await b.service.pull()).success).toBe(false)
    expect(b.engine.getRun(run.id)).toBeDefined()
  })

  it('never refreshes the SHA and overwrites a concurrent writer after HTTP 409', async () => {
    const a = device()
    const run = await a.engine.createRun('project', template)
    await a.service.push()
    run.nodes[0].userInput = 'local'; await a.engine.persist()
    let writes = 0
    beforePut = path => {
      if (path !== runPath(run.id)) return
      writes++
      const competing = read(run.id); competing.nodes[0].userInput = 'other device'
      write(run.id, competing)
    }
    await expect(a.service.push()).rejects.toThrow('409')
    expect(writes).toBe(1)
    expect(read(run.id).nodes[0].userInput).toBe('other device')
    expect(a.service.getStatus().dirty).toBe(true)
  })

  it('does not overwrite a locally executing node when remote content changes', async () => {
    const a = device()
    const run = await a.engine.createRun('project', template)
    await a.engine.startNode(run.id, run.nodes[0].id)
    await a.service.push()
    const updated = read(run.id); updated.name = 'remote name'; write(run.id, updated)
    expect((await a.service.pull()).success).toBe(false)
    expect(a.engine.getRun(run.id)?.nodes[0].status).toBe('running')
    expect(a.engine.getRun(run.id)?.name).not.toBe('remote name')
  })
})
