import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { WorkflowEngine } from '../src/services/workflow-engine.js'
import { AgentService } from '../src/services/agent.js'
import { RepoIsolationService } from '../src/services/repo-isolation.js'
import { ValidationTurnService } from '../src/services/validation-turn.js'
import { ArtifactMergeService } from '../src/services/artifact-merge.js'
import { GitService } from '../src/services/git.js'

describe('Agent execution → verification → review', () => {
  it('executes DET in the nested isolated cwd, verifies the same code, retries and passes it downstream', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-isolated-agent-'))
    try {
      const project = join(root, 'project')
      mkdirSync(join(project, 'src'), { recursive: true })
      writeFileSync(join(project, 'src', '.keep'), '')
      execFileSync('git', ['init', '-q', '-b', 'main', project])
      execFileSync('git', ['add', '.'], { cwd: project })
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com',
        '-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline'], { cwd: project })
      const engine = new WorkflowEngine(':memory:')
      const run = await engine.createRun('project', { id: 'template', name: 'Isolation', description: '',
        nodes: [
          { id: 'parent', name: 'Parent', type: 'implement', description: '', agentRole: 'executor', skillIds: [],
            scriptCwd: 'src', exitConditions: [{ type: 'test_pass', value: 'test -f result.txt' }] },
          { id: 'child', name: 'Child', type: 'implement', description: '', agentRole: 'executor', skillIds: [],
            scriptCwd: 'src', exitConditions: [{ type: 'test_pass', value: 'test -f child.txt' }] },
        ], edges: [{ source: 'parent', target: 'child' }] })
      const [parent, child] = run.nodes
      const isolation = new RepoIsolationService(join(root, 'workspaces'))
      const agent = new AgentService(engine)
      const projects = { getProject: () => ({ path: project }) } as never
      agent.injectWorkspaces(isolation, projects)
      const verification = new ValidationTurnService()
      verification.inject({ workflowEngine: engine, repoIsolation: isolation, projectService: projects,
        contractValidator: {} as never, feedbackCollector: { recordValidationFailure() {} } as never,
        robustnessService: { audit() {} } as never })
      engine.setCompletionVerifier((r, n) => ({ passed: verification.getValidationResult(r.id, n.id)?.passed === true }))
      engine.setExitVerifier((r, n, c) => verification.hasPassingCheck(r.id, n.id, c))
      agent.injectAutoFlow({ evaluateAndDecideAsync: async (r: string, n: string) => {
        await verification.validate(r, n)
        return 'waiting_user_review'
      } } as never)
      await engine.startRun(run.id)
      await engine.startNode(run.id, parent.id)
      const output = "printf 'Implemented requested functionality with tests. %.0s' 1 2 3 4 5 6 7 8 9 10"
      const firstId = agent.executeDET({ runId: run.id, nodeId: parent.id, script: `echo first > result.txt; ${output}`, cwd: project })
      await vi.waitFor(() => expect(parent.status).toBe('wait_user_review'), { timeout: 10_000 })
      expect(verification.getValidationResult(run.id, parent.id)?.passed).toBe(true)
      expect(existsSync(join(project, 'src', 'result.txt'))).toBe(false)
      await engine.rejectNode(run.id, parent.id, 'Improve it')
      await engine.startNode(run.id, parent.id)
      const secondId = agent.executeDET({ runId: run.id, nodeId: parent.id, script: `test -f result.txt && echo second > result.txt; ${output}` })
      await vi.waitFor(() => expect(parent.status).toBe('wait_user_review'), { timeout: 10_000 })
      expect(verification.getValidationResult(run.id, parent.id)?.turnId).toBe(secondId)
      expect(readFileSync(join(isolation.executions.get(firstId)!.execution.cwd, 'result.txt'), 'utf8')).toBe('first\n')
      await engine.approveNode(run.id, parent.id)
      await engine.startNode(run.id, child.id)
      const childId = agent.executeDET({ runId: run.id, nodeId: child.id, script: `test -f result.txt && cp result.txt child.txt; ${output}` })
      await vi.waitFor(() => expect(child.status).toBe('wait_user_review'), { timeout: 10_000 })
      expect(verification.getValidationResult(run.id, child.id)?.passed).toBe(true)
      const reviews = new ArtifactMergeService(isolation, new GitService())
      const review = reviews.prepareDiffReview({ runId: run.id, nodeId: child.id, turnId: childId })!
      expect(review.files.map(f => f.path)).toEqual(expect.arrayContaining(['src/result.txt', 'src/child.txt']))
      await engine.approveNode(run.id, child.id)
      reviews.setDeliveryVerifier((t, r, n) => engine.getNodeTurns(n).at(-1)?.id === t &&
        engine.getRun(r)?.nodes.find(item => item.id === n)?.status === 'completed' &&
        verification.getValidationResult(r, n)?.passed === true)
      expect(reviews.mergeBranch(childId).success).toBe(true)
      expect(readFileSync(join(project, 'src', 'child.txt'), 'utf8')).toBe('second\n')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
  it.each(['LLM', 'HYB'] as const)('%s uses an isolated cwd (including HYB fallback)', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'agentflow-provider-fixture-'))
    try {
      const project = join(root, 'project')
      mkdirSync(project)
      execFileSync('git', ['init', '-q', '-b', 'main', project])
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com',
        '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'baseline'], { cwd: project })
      const cli = join(root, 'fake-agent')
      writeFileSync(cli, '#!/bin/sh\necho fixed > result.txt\necho "Implemented requested changes successfully with tests."\n', { mode: 0o755 })
      const engine = new WorkflowEngine(':memory:')
      const run = await engine.createRun('project', { id: 't', name: '', description: '',
        nodes: [{ id: 'n', name: 'Node', type: 'implement', description: '', agentRole: 'executor', skillIds: [] }], edges: [] })
      const node = run.nodes[0]
      const isolation = new RepoIsolationService(join(root, 'workspaces'))
      const agent = new AgentService(engine)
      agent.injectWorkspaces(isolation, { getProject: () => ({ path: project }) } as never)
      agent.registerAgent({ id: 'fixture', name: 'Fixture', type: 'custom-cli', command: cli, role: 'executor' })
      await engine.startRun(run.id)
      await engine.startNode(run.id, node.id)
      const params = { runId: run.id, nodeId: node.id, agentId: 'fixture', prompt: 'Fix the task', cwd: project }
      if (mode === 'HYB') agent.executeHYB({ ...params, script: 'echo partial > partial.txt; exit 7' })
      else agent.startTurnAsync(params)
      await vi.waitFor(() => expect(node.status).toBe('wait_user_review'), { timeout: 10_000 })
      const turns = engine.getNodeTurns(node.id)
      const workspace = isolation.executions.assertSnapshot(turns.at(-1)!.id)
      expect(readFileSync(join(workspace.execution.cwd, 'result.txt'), 'utf8')).toBe('fixed\n')
      expect(existsSync(join(project, 'result.txt'))).toBe(false)
      if (mode === 'HYB') {
        expect(turns).toHaveLength(2)
        expect(readFileSync(join(workspace.execution.cwd, 'partial.txt'), 'utf8')).toBe('partial\n')
        expect(isolation.executions.get(turns[0].id)!.execution.cwd).not.toBe(workspace.execution.cwd)
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 20_000)

})
