import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { WorkflowEngine } from '../src/services/workflow-engine.js'
import { AgentService } from '../src/services/agent.js'
import { RepoIsolationService } from '../src/services/repo-isolation.js'
import { ValidationTurnService } from '../src/services/validation-turn.js'
import { ReadyDispatcher } from '../src/services/ready-dispatcher.js'
import { ArtifactMergeService } from '../src/services/artifact-merge.js'
import { GitService } from '../src/services/git.js'
import { ProjectService } from '../src/services/project.js'
import { SkillService } from '../src/services/skill.js'
import { SkillExtractionService } from '../src/services/skill-extraction.js'
import type { DAGEdge, TaskNode } from '../src/types/index.js'

describe('Code review regressions across workflow services', () => {
  let root: string
  const agents: AgentService[] = []
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'agentflow-cr-')) })
  afterEach(async () => { await Promise.all(agents.splice(0).map(a => a.shutdown())); rmSync(root, { recursive: true, force: true }) })
  async function fixture(names = ['a'], edges: DAGEdge[] = []) {
    const project = join(root, 'project'); mkdirSync(project)
    execFileSync('git', ['init', '-q', '-b', 'main', project])
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      'commit', '--allow-empty', '-qm', 'baseline'], { cwd: project })
    const database = join(root, 'state.db')
    const engine = new WorkflowEngine(database)
    const run = await engine.createRun('project', { id: 't', name: 'CR', description: '', nodes: names.map(id => ({ id,
      name: id, type: 'review', description: '', agentRole: 'executor', skillIds: [] })), edges })
    const isolation = new RepoIsolationService(join(root, 'workspaces'))
    const agent = new AgentService(engine); agents.push(agent)
    agent.injectWorkspaces(isolation, { getProject: () => ({ path: project }) } as never)
    const verification = new ValidationTurnService()
    verification.inject({ workflowEngine: engine, repoIsolation: isolation, contractValidator: {} as never,
      feedbackCollector: { recordValidationFailure() {} } as never, robustnessService: { audit() {} } as never })
    agent.injectAutoFlow({ evaluateAndDecideAsync: async (_r: string, n: string) => {
      await verification.validate(run.id, n); return 'waiting_user_review'
    } } as never)
    engine.setCompletionVerifier((r, n) => ({ passed: verification.getValidationResult(r.id, n.id)?.passed === true }))
    engine.setExitVerifier((r, n, c) => verification.hasPassingCheck(r.id, n.id, c))
    await engine.startRun(run.id)
    const execute = async (node: TaskNode, script: string, approve = true) => {
      await engine.startNode(run.id, node.id)
      const turnId = agent.executeDET({ runId: run.id, nodeId: node.id, script })
      await vi.waitFor(() => expect(node.status).toBe('wait_user_review'), { timeout: 10_000 })
      if (approve) await engine.approveNode(run.id, node.id)
      return isolation.executions.assertSnapshot(turnId)
    }
    return { project, database, engine, run, isolation, agent, verification, execute }
  }

  it.each(['forceResetNode', 'rollbackNode', 'deleteRun'] as const)('%s stops execution before mutation and ignores its stale callback', async operation => {
    const f = await fixture(); const node = f.run.nodes[0]
    await f.engine.startNode(f.run.id, node.id)
    const turnId = f.agent.executeDET({ runId: f.run.id, nodeId: node.id, script: 'echo STARTED; sleep 0.7; echo late > late.txt' })
    await vi.waitFor(() => expect(f.engine.getNodeTurns(node.id)[0].output).toContain('STARTED'), { timeout: 10_000 })
    const cwd = f.isolation.executions.get(turnId)!.execution.cwd
    if (operation === 'deleteRun') await f.engine.deleteRun(f.run.id)
    else await f.engine[operation](f.run.id, node.id)
    expect(f.agent.getActiveTurnIds()).toEqual([])
    await new Promise(resolve => setTimeout(resolve, 850))
    expect(existsSync(join(cwd, 'late.txt'))).toBe(false)
    if (operation !== 'deleteRun') {
      expect(node.status).toBe('ready')
      expect(f.engine.getNodeTurns(node.id)[0].status).toBe('error')
      const retry = await f.execute(node, 'echo retry > retry.txt')
      expect(readFileSync(join(retry.execution.cwd, 'retry.txt'), 'utf8')).toBe('retry\n')
    } else expect(f.engine.getRun(f.run.id)).toBeUndefined()
  }, 15_000)

  it('uses the new upstream code after rollback and permits verified final delivery', async () => {
    const f = await fixture(['a', 'b'], [{ source: 'a', target: 'b' }]); const [a, b] = f.run.nodes
    await f.execute(a, 'echo v1 > upstream.txt'); await f.execute(b, 'cp upstream.txt downstream.txt')
    await f.engine.rollbackNode(f.run.id, a.id)
    await f.execute(a, 'echo v2 > upstream.txt')
    const final = await f.execute(b, 'cp upstream.txt downstream.txt')
    expect(readFileSync(join(final.execution.cwd, 'downstream.txt'), 'utf8')).toBe('v2\n')
    const merge = new ArtifactMergeService(f.isolation, new GitService())
    merge.setDeliveryVerifier((turn, run, node) => f.engine.getNodeTurns(node).at(-1)?.id === turn && f.verification.getValidationResult(run, node)?.passed === true)
    merge.prepareDiffReview({ runId: f.run.id, nodeId: b.id, turnId: final.turnId })
    expect(merge.mergeBranch(final.turnId).success).toBe(true)
    expect(readFileSync(join(f.project, 'upstream.txt'), 'utf8')).toBe('v2\n')
  }, 20_000)

  it('forwards approved code across skipped nodes without including inactive conditional branches', async () => {
    const f = await fixture(['a', 'inactive', 'skip', 'final'], [{ source: 'a', target: 'skip' },
      { source: 'inactive', target: 'skip', condition: { type: 'status', value: 'failed' } }, { source: 'skip', target: 'final' }])
    const [a, inactive, skip, final] = f.run.nodes
    await f.execute(a, 'echo approved > approved.txt')
    await f.execute(inactive, 'echo excluded > excluded.txt')
    await f.engine.skipNode(f.run.id, skip.id)
    const workspace = await f.execute(final, 'test -f approved.txt && test ! -f excluded.txt')
    expect(existsSync(join(workspace.execution.cwd, 'approved.txt'))).toBe(true)
    expect(existsSync(join(workspace.execution.cwd, 'excluded.txt'))).toBe(false)
  }, 15_000)

  it('resolves scriptCwd after every predecessor is merged and preserves preparation failures in the ledger', async () => {
    const f = await fixture(['a', 'b', 'final'], [{ source: 'a', target: 'final' }, { source: 'b', target: 'final' }])
    const [a, b, final] = f.run.nodes
    await f.execute(a, 'echo a > a.txt')
    await f.execute(b, 'mkdir generated; echo b > generated/b.txt')
    final.scriptCwd = 'generated'
    const workspace = await f.execute(final, 'test -f b.txt && test -f ../a.txt')
    expect(workspace.execution.cwd.endsWith('/generated')).toBe(true)
    expect(existsSync(join(f.project, 'generated'))).toBe(false)
    expect(() => f.isolation.executions.prepare({ runId: f.run.id, nodeId: 'bad', turnId: 'bad', agentId: 'agent',
      projectPath: f.project, scriptCwd: 'missing', predecessorTurnIds: [] })).toThrow()
    expect(f.isolation.executions.get('bad')).toBeDefined()
  }, 15_000)

  it('does not resurrect rolled-back artifacts after SQLite reload', async () => {
    const f = await fixture(); const node = f.run.nodes[0]
    await f.engine.addArtifact(f.run.id, node.id, { title: 'obsolete', category: 'document', format: 'markdown', content: 'old' })
    await f.engine.rollbackNode(f.run.id, node.id)
    const reloaded = new WorkflowEngine(f.database); await reloaded.load()
    expect(reloaded.getRun(f.run.id)!.nodes[0].artifacts).toEqual([])
  })

  it('queues a rejected node without occupying or exceeding execution capacity', async () => {
    const f = await fixture(['a', 'b']); const [a, b] = f.run.nodes
    await f.engine.updateRunConfig(f.run.id, { maxParallel: 1, autoExecute: true })
    await f.execute(a, 'echo done', false)
    await f.engine.startNode(f.run.id, b.id)
    await f.engine.rejectNode(f.run.id, a.id, 'redo')
    expect(a.status).toBe('ready')
    const execute = vi.fn(async () => {})
    const dispatcher = new ReadyDispatcher({ getRun: id => f.engine.getRun(id), startNode: (r, n) => f.engine.startNode(r, n), execute, fail: async () => {} })
    await dispatcher.request(f.run.id); expect(execute).not.toHaveBeenCalled()
    await f.engine.submitNodeDecision(f.run.id, b.id, 'failed')
    await dispatcher.request(f.run.id); expect(execute).toHaveBeenCalledTimes(1)
    expect(f.run.nodes.filter(n => n.status === 'running')).toHaveLength(1)
  })

  it('keeps feedback separate from verified artifacts while forwarding it to successors', async () => {
    const f = await fixture(['a', 'b'], [{ source: 'a', target: 'b' }]); const [a, b] = f.run.nodes
    await f.execute(a, 'echo approved', false)
    await f.engine.approveNode(f.run.id, a.id, 'Remember this decision')
    expect(f.verification.getValidationResult(f.run.id, a.id)?.passed).toBe(true)
    expect(a.artifacts).toEqual([])
    expect(b.context?.predecessorOutputs[0].artifacts.some(a => a.content === 'Remember this decision')).toBe(true)
    const reloaded = new WorkflowEngine(f.database); await reloaded.load()
    expect(reloaded.getRun(f.run.id)!.nodes[0].approvalFeedback?.[0].content).toBe('Remember this decision')
  })

  it('extracts reusable skills into application storage without blocking approved code delivery', async () => {
    const f = await fixture()
    const skills = new SkillService()
    const projects = new ProjectService(skills, join(root, 'app-data'))
    await projects.addProjectWithId({ id: 'project', name: 'Project', path: f.project })
    const workspace = await f.execute(f.run.nodes[0], 'echo approved > result.txt')
    const content = Array.from({ length: 8 }, (_, i) => `## Template ${i}\n模板 规范 架构 reusable utility checklist workflow strategy\n${'details '.repeat(80)}\n\`\`\`ts\nconst x = 1\n\`\`\`\n`).join('\n')
    const extractor = new SkillExtractionService(skills, projects)
    const extracted = await extractor.extractFromNode({ ...f.run.nodes[0], type: 'design', artifacts: [
      { id: 'art', nodeId: f.run.nodes[0].id, title: 'Reusable', category: 'document', format: 'markdown', content, createdAt: 1 },
    ] }, f.run)
    expect(extracted).toHaveLength(1)
    expect(extracted[0].path.startsWith(join(root, 'app-data'))).toBe(true)
    expect((await skills.loadSkills([projects.getSkillsDir('project')!])).some(skill => skill.name === extracted[0].name)).toBe(true)
    const reviews = new ArtifactMergeService(f.isolation, new GitService())
    reviews.setDeliveryVerifier((_t, r, n) => f.verification.getValidationResult(r, n)?.passed === true)
    reviews.prepareDiffReview({ runId: f.run.id, nodeId: f.run.nodes[0].id, turnId: workspace.turnId })
    expect(reviews.mergeBranch(workspace.turnId).success).toBe(true)
  })

  it('rejects and terminates background validation processes before publishing evidence', async () => {
    const f = await fixture(); const node = f.run.nodes[0]
    const workspace = await f.execute(node, 'echo done', false)
    node.exitConditions = [{ type: 'test_pass', value: '(sleep 0.7; echo late > validation-late.txt) >/dev/null 2>&1 &' }]
    const result = await f.verification.validate(f.run.id, node.id)
    expect(result.passed).toBe(false)
    expect(result.details.some(d => d.output?.includes('background processes'))).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 850))
    expect(existsSync(join(workspace.execution.cwd, 'validation-late.txt'))).toBe(false)
  }, 10_000)

  it('cancels validation as part of a reset, without a late approval or late writes', async () => {
    const f = await fixture(); const node = f.run.nodes[0]
    const marker = join(root, 'validation-started')
    node.exitConditions = [{ type: 'test_pass', value: `echo started > '${marker}'; sleep 0.7; echo late > late.txt` }]
    await f.engine.startNode(f.run.id, node.id)
    const turn = f.agent.executeDET({ runId: f.run.id, nodeId: node.id, script: 'echo done' })
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 8000 })
    const cwd = f.isolation.executions.get(turn)!.execution.cwd
    await f.engine.forceResetNode(f.run.id, node.id)
    await new Promise(resolve => setTimeout(resolve, 850))
    expect(node.status).toBe('ready')
    expect(f.verification.getValidationResult(f.run.id, node.id)).toBeUndefined()
    expect(existsSync(join(cwd, 'late.txt'))).toBe(false)
  }, 12_000)
})
