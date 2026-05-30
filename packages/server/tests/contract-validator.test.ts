import { describe, it, expect } from 'vitest'
import { ContractValidatorService } from '../src/services/contract-validator.js'
import type { OutputContract, Artifact, TaskNode } from '../src/types/index.js'

describe('ContractValidatorService', () => {
  const validator = new ContractValidatorService()

  // ─── Test Fixtures ───

  const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
    id: 'art_001',
    nodeId: 'node_1',
    title: 'Test Artifact',
    category: 'code',
    format: 'typescript',
    content: 'const x = 1;',
    createdAt: Date.now(),
    ...overrides,
  })

  const makeContract = (overrides: Partial<OutputContract> = {}): OutputContract => ({
    id: 'contract_001',
    title: 'Test Contract',
    category: 'code',
    format: 'typescript',
    required: true,
    ...overrides,
  })

  describe('validate', () => {
    it('should pass when all required contracts are satisfied', () => {
      const contracts: OutputContract[] = [
        makeContract({ id: 'c1', category: 'code', format: 'typescript' }),
        makeContract({ id: 'c2', category: 'document', format: 'markdown', required: false }),
      ]
      const artifacts: Artifact[] = [
        makeArtifact({ id: 'a1', category: 'code', format: 'typescript', content: 'code' }),
      ]

      const result = validator.validate('node_1', contracts, artifacts)

      expect(result.passed).toBe(true)
      expect(result.nodeId).toBe('node_1')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].satisfied).toBe(true)
      expect(result.results[1].satisfied).toBe(false) // optional, not satisfied but doesn't block
    })

    it('should fail when required contract is not satisfied', () => {
      const contracts: OutputContract[] = [
        makeContract({ id: 'c1', category: 'code', format: 'typescript', required: true }),
        makeContract({ id: 'c2', category: 'document', format: 'markdown', required: true }),
      ]
      const artifacts: Artifact[] = [
        makeArtifact({ id: 'a1', category: 'code', format: 'typescript' }),
        // Missing document artifact
      ]

      const result = validator.validate('node_1', contracts, artifacts)

      expect(result.passed).toBe(false)
      expect(result.results[0].satisfied).toBe(true)
      expect(result.results[1].satisfied).toBe(false)
      expect(result.results[1].reason).toContain('No artifact matches contract')
    })

    it('should pass with empty contracts list', () => {
      const result = validator.validate('node_1', [], [])
      expect(result.passed).toBe(true)
      expect(result.results).toHaveLength(0)
    })

    it('should fail if artifact content is empty', () => {
      const contracts: OutputContract[] = [
        makeContract({ id: 'c1', category: 'code', format: 'typescript', required: true }),
      ]
      const artifacts: Artifact[] = [
        makeArtifact({ id: 'a1', category: 'code', format: 'typescript', content: '', filePath: undefined }),
      ]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.passed).toBe(false)
      expect(result.results[0].reason).toContain('empty content')
    })

    it('should pass if artifact has filePath even without content', () => {
      const contracts: OutputContract[] = [
        makeContract({ id: 'c1', category: 'code', format: 'typescript', required: true }),
      ]
      const artifacts: Artifact[] = [
        makeArtifact({ id: 'a1', category: 'code', format: 'typescript', content: undefined, filePath: '/path/to/file.ts' }),
      ]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.passed).toBe(true)
    })
  })

  describe('format compatibility', () => {
    it('should match exact format', () => {
      const contracts = [makeContract({ category: 'code', format: 'typescript' })]
      const artifacts = [makeArtifact({ category: 'code', format: 'typescript' })]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.results[0].satisfied).toBe(true)
    })

    it('should match normalized format (ts → typescript)', () => {
      const contracts = [makeContract({ category: 'code', format: 'typescript' })]
      const artifacts = [makeArtifact({ category: 'code', format: 'ts' })]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.results[0].satisfied).toBe(true)
    })

    it('should match format group (typescript belongs to code group)', () => {
      const contracts = [makeContract({ category: 'code', format: 'code' })]
      const artifacts = [makeArtifact({ category: 'code', format: 'typescript' })]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.results[0].satisfied).toBe(true)
    })

    it('should match md → markdown normalization', () => {
      const contracts = [makeContract({ category: 'document', format: 'markdown' })]
      const artifacts = [makeArtifact({ category: 'document', format: 'md' })]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.results[0].satisfied).toBe(true)
    })

    it('should match json in config group', () => {
      const contracts = [makeContract({ category: 'config', format: 'config' })]
      const artifacts = [makeArtifact({ category: 'config', format: 'json' })]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.results[0].satisfied).toBe(true)
    })

    it('should NOT match incompatible formats', () => {
      const contracts = [makeContract({ category: 'code', format: 'python' })]
      const artifacts = [makeArtifact({ category: 'code', format: 'markdown' })]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.results[0].satisfied).toBe(false)
    })

    it('should NOT match different categories', () => {
      const contracts = [makeContract({ category: 'document', format: 'markdown' })]
      const artifacts = [makeArtifact({ category: 'code', format: 'markdown' })]

      const result = validator.validate('node_1', contracts, artifacts)
      expect(result.results[0].satisfied).toBe(false)
    })
  })

  describe('validateNode', () => {
    it('should validate a TaskNode with template contracts', () => {
      const node: TaskNode = {
        id: 'node_1',
        runId: 'run_1',
        name: 'Test Node',
        type: 'implement',
        description: 'Test',
        status: 'completed',
        agentRole: 'executor',
        skillIds: [],
        artifacts: [
          makeArtifact({ category: 'code', format: 'typescript' }),
        ],
        order: 0,
      }
      const contracts = [
        makeContract({ category: 'code', format: 'typescript', required: true }),
      ]

      const result = validator.validateNode(node, contracts)
      expect(result.passed).toBe(true)
    })

    it('should pass with no contracts (no requirements)', () => {
      const node: TaskNode = {
        id: 'node_1',
        runId: 'run_1',
        name: 'Test Node',
        type: 'implement',
        description: 'Test',
        status: 'completed',
        agentRole: 'executor',
        skillIds: [],
        artifacts: [],
        order: 0,
      }

      const result = validator.validateNode(node)
      expect(result.passed).toBe(true)
    })
  })

  describe('formatReport', () => {
    it('should format a passing report', () => {
      const contracts = [makeContract({ category: 'code', format: 'typescript' })]
      const artifacts = [makeArtifact({ category: 'code', format: 'typescript' })]

      const result = validator.validate('node_1', contracts, artifacts)
      const report = validator.formatReport(result)

      expect(report).toContain('✅')
      expect(report).toContain('PASSED')
      expect(report).toContain('node_1')
    })

    it('should format a failing report', () => {
      const contracts = [makeContract({ category: 'document', format: 'markdown', required: true })]
      const artifacts: Artifact[] = []

      const result = validator.validate('node_1', contracts, artifacts)
      const report = validator.formatReport(result)

      expect(report).toContain('❌')
      expect(report).toContain('FAILED')
      expect(report).toContain('REQUIRED')
    })
  })
})
