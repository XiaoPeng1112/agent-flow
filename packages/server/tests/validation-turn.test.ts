import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ValidationTurnService } from '../src/services/validation-turn.js'
import type { AgentTurn, Run, TaskNode } from '../src/types/index.js'

function fixture(path?: string) {
  if (path) {
    execFileSync('git', ['init', '-q', path])
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'baseline'], { cwd: path })
  }
  const node: TaskNode = { id: 'node', runId: 'run', name: 'Implement', type: 'implement',
    description: '', status: 'running', agentRole: 'executor', skillIds: [], artifacts: [], order: 0,
    exitConditions: [{ type: 'test_pass', value: 'exit 0' }] }
  const run: Run = { id: 'run', projectId: 'project', templateId: 'template', name: '', status: 'running',
    nodes: [node], edges: [], createdAt: 1 }
  const turn: AgentTurn = { id: 'turn', runId: 'run', nodeId: 'node', agentId: 'agent', turnIndex: 0,
    status: 'completed', prompt: '', output: 'Implemented the requested changes. '.repeat(30), startedAt: 1, completedAt: 2 }
  const service = new ValidationTurnService()
  service.inject({ workflowEngine: { getRun: () => run, getNodeTurns: () => [turn] } as never,
    contractValidator: {} as never, feedbackCollector: { recordValidationFailure() {} } as never,
    robustnessService: { audit() {} } as never,
    projectService: { getProject: () => path ? { path } : undefined } as never })
  return { service, node, run, turn }
}

describe('ValidationTurnService required checks', () => {
  it('fails a real nonzero script even when other checks pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-validation-'))
    try {
      const { service, node } = fixture(dir)
      node.exitConditions![0].value = 'exit 7'
      const result = await service.validate('run', 'node')
      expect(result.passed).toBe(false)
      expect(result.details.find(item => item.name === 'Test')?.passed).toBe(false)
      expect(service.hasPassingCheck('run', 'node', node.exitConditions![0])).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('does not treat missing working directory as passing verification', async () => {
    const { service } = fixture()
    const result = await service.validate('run', 'node')
    expect(result.passed).toBe(false)
  })
  it('does not reuse verification after a new turn or changed check configuration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-validation-'))
    try {
      const { service, node, turn } = fixture(dir)
      expect((await service.validate('run', 'node')).passed).toBe(true)
      expect(service.hasPassingCheck('run', 'node', node.exitConditions![0])).toBe(true)
      writeFileSync(join(dir, 'source.ts'), 'export const value = 1')
      expect(service.getValidationResult('run', 'node')).toBeUndefined()
      expect((await service.validate('run', 'node')).passed).toBe(true)
      writeFileSync(join(dir, 'source.ts'), 'export const value = 2')
      expect(service.getValidationResult('run', 'node')).toBeUndefined()
      await service.validate('run', 'node')
      node.exitConditions![0].value = 'exit 1'
      expect(service.getValidationResult('run', 'node')).toBeUndefined()
      node.exitConditions![0].value = 'exit 0'
      turn.id = 'retry'
      expect(service.getValidationResult('run', 'node')).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('clears an old success when verification is subsequently disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentflow-validation-'))
    try {
      const { service, run } = fixture(dir)
      await service.validate('run', 'node')
      run.config = { autoFlow: { enabled: true, confidenceThreshold: 75, validation: { enabled: false } } } as any
      const result = await service.validate('run', 'node')
      expect(result.strategy).toBe('skipped')
      expect(result.passed).toBe(false)
      expect(service.getValidationResult('run', 'node')).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
