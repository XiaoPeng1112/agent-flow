import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { WorkflowEngine } from '../src/services/workflow-engine.js'
import { AgentService } from '../src/services/agent.js'
import { RepoIsolationService } from '../src/services/repo-isolation.js'
import { ProviderJournal } from '../src/services/providers/journal.js'

describe('Durable provider recovery', () => {
  it.each(['codex', 'claude'] as const)('%s persists protocol events and explicitly resumes an interrupted session after restart', async provider => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-provider-recovery-'))
    try {
      const project = join(root, 'project')
      mkdirSync(project)
      execFileSync('git', ['init', '-q', '-b', 'main', project])
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
        'commit', '--allow-empty', '-qm', 'baseline'], { cwd: project })
      const cli = join(root, 'fake-provider')
      writeFileSync(cli, `#!/usr/bin/env node
const fs = require('fs');
fs.readFileSync(0, 'utf8');
const resumed = process.argv.includes('resume') || process.argv.includes('--resume');
const emit = event => process.stdout.write(JSON.stringify(event) + '\\n');
const provider = ${JSON.stringify(provider)};
const id = 'session_local_fixture';
if (resumed && !fs.existsSync('partial.txt')) process.exit(9);
fs.writeFileSync(resumed ? 'complete.txt' : 'partial.txt', process.cwd());
if (provider === 'codex') {
  emit({type:'thread.started',thread_id:id});
  emit({type:'item.completed',item:{id:'message',type:'agent_message',text:'Structured output'}});
  emit(resumed ? {type:'turn.completed',usage:{input_tokens:11,output_tokens:7}} : {type:'turn.failed',error:{message:'Interrupted'}});
} else {
  emit({type:'system',subtype:'init',session_id:id});
  emit({type:'assistant',uuid:'m',message:{content:[{type:'text',text:'Structured output'}]}});
  emit({type:'result',session_id:id,subtype:resumed?'success':'error_during_execution',is_error:!resumed,usage:{input_tokens:11,output_tokens:7}});
}
`, { mode: 0o755 })
      const db = join(root, 'data.db')
      let engine = new WorkflowEngine(db)
      const run = await engine.createRun('project', { id: 'template', name: '', description: '', nodes: [
        { id: 'node', name: 'Node', type: 'implement', description: '', agentRole: 'executor', skillIds: [] },
      ], edges: [] })
      const nodeId = run.nodes[0].id
      const makeAgent = () => {
        const isolation = new RepoIsolationService(join(root, 'workspaces'))
        const agent = new AgentService(engine)
        agent.injectWorkspaces(isolation, { getProject: () => ({ path: project }) } as never)
        agent.registerAgent({ id: 'fixture', name: 'Fixture', type: provider, command: cli, role: 'executor' })
        return { isolation, agent }
      }
      let { isolation, agent } = makeAgent()
      await engine.startRun(run.id)
      await engine.startNode(run.id, nodeId)
      const firstId = agent.startTurnAsync({ runId: run.id, nodeId, agentId: 'fixture', prompt: 'Do work' })
      await vi.waitFor(() => expect(run.nodes[0].status).toBe('failed'), { timeout: 10_000 })
      const first = engine.getNodeTurns(nodeId)[0]
      expect(first.status).toBe('error') // exit 0 + provider failure cannot pass
      expect(first.providerExecution?.sessionId).toBe('session_local_fixture')
      expect(first.output).not.toContain('"type"')
      const cwd = isolation.executions.get(firstId)!.execution.cwd
      const savedProvider = isolation.executions.providers.get(firstId)!
      isolation.executions.providers.set(firstId, { ...savedProvider, pid: process.pid })
      await expect(agent.resumeProviderTurn({ runId: run.id, nodeId, turnId: firstId, prompt: 'Continue' })).rejects.toThrow('still be alive')
      isolation.executions.providers.set(firstId, savedProvider)
      agent.registerAgent({ id: 'fixture', name: 'Changed', type: provider, command: cli, role: 'executor', model: 'different' })
      await expect(agent.resumeProviderTurn({ runId: run.id, nodeId, turnId: firstId, prompt: 'Continue' })).rejects.toThrow('configuration changed')
      // Model the durable state at an abrupt service exit after the session event was received.
      run.nodes[0].status = 'running'
      first.status = 'running'
      await engine.persist()
      engine = new WorkflowEngine(db)
      await engine.load()
      ;({ isolation, agent } = makeAgent())
      expect(engine.getRun(run.id)!.status).toBe('paused')
      expect(engine.getNodeTurns(nodeId)[0].providerExecution?.sessionId).toBe('session_local_fixture')
      await expect(agent.resumeProviderTurn({ runId: run.id, nodeId, turnId: firstId, prompt: 'Continue' })).rejects.toThrow('Resume the run')
      await engine.resumeRun(run.id)
      const attempts = await Promise.allSettled([
        agent.resumeProviderTurn({ runId: run.id, nodeId, turnId: firstId, prompt: 'Continue' }),
        agent.resumeProviderTurn({ runId: run.id, nodeId, turnId: firstId, prompt: 'Duplicate click' }),
      ])
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const secondId = (attempts.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<string>).value
      await vi.waitFor(() => expect(engine.getRun(run.id)!.nodes[0].status).toBe('wait_user_review'), { timeout: 10_000 })
      expect(isolation.executions.get(secondId)!.execution.cwd).toBe(cwd)
      expect(readFileSync(join(cwd, 'complete.txt'), 'utf8')).toBe(cwd)
      expect(engine.getNodeTurns(nodeId).at(-1)?.tokenUsage).toEqual({ input: 11, output: 7, total: 18 })
      expect(engine.getNodeTurns(nodeId).at(-1)?.providerExecution?.resumedFromTurnId).toBe(firstId)
      const events = agent.getProviderEvents(run.id, nodeId, secondId)
      expect(events.events.map(event => event.event.type)).toEqual(['session', 'text', 'usage', 'completed'])
      expect(agent.getProviderEvents(run.id, nodeId, secondId, events.nextCursor).events).toEqual([])
      expect(() => agent.getProviderEvents('foreign', nodeId, secondId)).toThrow()
      await expect(agent.resumeProviderTurn({ runId: run.id, nodeId, turnId: firstId, prompt: 'Again' })).rejects.toThrow('latest failed')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)

  it('paginates journal replay and tolerates only a truncated final append', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-event-journal-'))
    try {
      const journal = new ProviderJournal(root)
      for (let sequence = 1; sequence <= 5; sequence++) journal.append('turn', { sequence, timestamp: sequence,
        event: { type: 'text', text: `event ${sequence}` } })
      appendFileSync(join(root, 'turn.jsonl'), '{"sequence":6')
      const page = journal.read('turn', 1, 2)
      expect(page.events.map(e => e.sequence)).toEqual([2, 3])
      expect(page.hasMore).toBe(true)
      expect(journal.read('turn', page.nextCursor, 2).events.map(e => e.sequence)).toEqual([4, 5])
      expect(() => journal.read('../outside')).toThrow()
      expect(() => journal.read('turn', -1)).toThrow()
      expect(() => journal.read('turn', NaN)).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
