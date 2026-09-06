import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentService } from '../src/services/agent.js'
import { WorkflowEngine } from '../src/services/workflow-engine.js'
import { ModelCatalogService, discoverCodexModels, codexModels } from '../src/services/model-catalog.js'
import { providerCommand } from '../src/services/providers/adapter.js'

const roots: string[] = []
const root = () => { const path = mkdtempSync(join(tmpdir(), 'af-models-')); roots.push(path); return path }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('Model settings and discovery', () => {
  it('defaults Codex agents to CLI selection and persists per-agent choices including reset', () => {
    const path = join(root(), 'models.json')
    const service = new AgentService(new WorkflowEngine(':memory:'), path)
    expect(service.getAgents().filter(a => a.type === 'codex').every(a => !a.model)).toBe(true)
    const original = service.getAgent('codex-coder')!
    expect(providerCommand(original, 'task').args).not.toContain('--model')
    service.setAgentModel(original.id, 'gpt-6-astra')
    expect(original.model).toBeUndefined() // Existing execution config is never mutated.
    const reloaded = new AgentService(new WorkflowEngine(':memory:'), path)
    expect(reloaded.getAgent(original.id)?.model).toBe('gpt-6-astra')
    expect(providerCommand(reloaded.getAgent(original.id)!, 'task').args).toContain('gpt-6-astra')
    expect(reloaded.getCards().find(c => c.id === original.id)?.provider.model).toBe('gpt-6-astra')
    reloaded.setAgentModel(original.id, '')
    expect(new AgentService(new WorkflowEngine(':memory:'), path).getAgent(original.id)?.model).toBeUndefined()
  })
  it('accepts custom IDs, rejects invalid settings and refuses active agent changes', async () => {
    const engine = new WorkflowEngine(':memory:'); const service = new AgentService(engine)
    service.setAgentModel('codex-coder', 'custom/model-v2')
    for (const value of [null, {}, '--bad', 'bad\nmodel', 'x'.repeat(201)]) expect(() => service.setAgentModel('codex-coder', value)).toThrow()
    expect(() => service.setAgentModel('missing', '')).toThrow()
    const run = await engine.createRun('p', { id: 't', name: 't', description: '', nodes: [{ id: 'n', name: 'n', description: '', type: 'custom', agentRole: 'executor', skillIds: [] }], edges: [] })
    engine.startTurn(run.nodes[0].id, run.id, 'codex-coder', 'task')
    expect(() => service.setAgentModel('codex-coder', 'gpt-5.5')).toThrow('正在执行')
    expect(service.getAgent('codex-coder')?.model).toBe('custom/model-v2')
  })
  it('coalesces discovery, caches it, preserves last success and has a labeled fallback', async () => {
    const discover = vi.fn().mockResolvedValueOnce([{ id: 'new-model', name: 'New' }]).mockRejectedValue(new Error('offline'))
    const catalog = new ModelCatalogService(discover)
    await Promise.all([catalog.get(), catalog.get(true)])
    expect(discover).toHaveBeenCalledTimes(1)
    expect((await catalog.get()).source).toBe('cli')
    expect((await catalog.get()).models.find(m => m.id === 'new-model')?.discovered).toBe(true)
    expect((await catalog.get()).models.find(m => m.id === 'gpt-6-astra')?.discovered).not.toBe(true)
    const failed = await catalog.get(true)
    expect(failed.models[0].id).toBe('new-model'); expect(failed.warning).toBeTruthy()
    const fallback = await new ModelCatalogService(async () => { throw new Error('missing') }).get()
    expect(fallback.source).toBe('builtin'); expect(fallback.models).toEqual(codexModels); expect(fallback.warning).toBeTruthy()
  })
  it('discovers paginated models over a real process without starting a task', async () => {
    const path = join(root(), 'cli')
    writeFileSync(path, `#!/usr/bin/env node
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', line => { const msg = JSON.parse(line); let result;
if (msg.method === 'initialize') result = {};
else if (msg.method === 'initialized') return;
else if (msg.method === 'model/list') result = msg.params.cursor ? { data: [{ model: 'gpt-5.6-sol', displayName: 'Sol' }], nextCursor: null } : { data: [{ model: 'gpt-6-astra', displayName: 'Astra' }, { model: 'hidden', hidden: true }], nextCursor: 'next' };
else process.exit(2);
process.stdout.write(JSON.stringify({ id: msg.id, result }) + '\\n'); });`, { mode: 0o755 })
    expect(await discoverCodexModels(path)).toEqual([{ id: 'gpt-6-astra', name: 'Astra' }, { id: 'gpt-5.6-sol', name: 'Sol' }])
  })
  it('rejects missing executables, broken protocol and timed out discovery', async () => {
    await expect(discoverCodexModels(join(root(), 'missing'))).rejects.toThrow()
    const path = join(root(), 'cli')
    writeFileSync(path, '#!/usr/bin/env node\nconsole.log("invalid");setInterval(()=>{},1000)', { mode: 0o755 })
    await expect(discoverCodexModels(path)).rejects.toThrow()
    writeFileSync(path, '#!/usr/bin/env node\nsetInterval(()=>{},1000)', { mode: 0o755 })
    await expect(discoverCodexModels(path, 100)).rejects.toThrow('超时')
  })
})
