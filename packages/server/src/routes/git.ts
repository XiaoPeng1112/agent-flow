import { Router } from 'express'
import type { GitService } from '../services/git.js'
import type { RepoIsolationService } from '../services/repo-isolation.js'
import type { PermissionIsolationService } from '../services/permission-isolation.js'
import type { ContractValidatorService } from '../services/contract-validator.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { TemplateService } from '../services/template.js'

export function createGitRouter(deps: {
  gitService: GitService
  repoIsolationService: RepoIsolationService
  permissionIsolationService: PermissionIsolationService
  contractValidatorService: ContractValidatorService
  workflowEngine: WorkflowEngine
  templateService: TemplateService
}): Router {
  const router = Router()
  const {
    gitService, repoIsolationService, permissionIsolationService,
    contractValidatorService, workflowEngine, templateService,
  } = deps

  // ═══════════════ Git API（Git 集成与 Diff Review） ═══════════════

  /** 获取 Git 仓库状态 */
  router.get('/status', (req, res) => {
    const { cwd } = req.query as { cwd?: string }
    const workDir = cwd || process.cwd()
    if (!gitService.isGitRepo(workDir)) {
      res.status(400).json({ success: false, error: 'Not a git repository' })
      return
    }
    const status = gitService.getStatus(workDir)
    res.json({ success: true, data: status })
  })

  /** 获取最近 commits */
  router.get('/commits', (req, res) => {
    const { cwd, count } = req.query as { cwd?: string; count?: string }
    const workDir = cwd || process.cwd()
    const commits = gitService.getRecentCommits(workDir, count ? parseInt(count, 10) : 10)
    res.json({ success: true, data: { commits } })
  })

  /** 获取工作区 diff */
  router.get('/diff', (req, res) => {
    const { cwd, from, to, staged } = req.query as { cwd?: string; from?: string; to?: string; staged?: string }
    const workDir = cwd || process.cwd()

    let diff: string
    if (from) {
      diff = gitService.getDiffBetween(workDir, from, to)
    } else if (staged === 'true') {
      diff = gitService.getStagedDiff(workDir)
    } else {
      diff = gitService.getWorkingDiff(workDir)
    }

    const summary = gitService.generateDiffSummary(diff)
    res.json({ success: true, data: { diff, summary } })
  })

  /** 获取变更文件列表 */
  router.get('/changed-files', (req, res) => {
    const { cwd, from, to } = req.query as { cwd?: string; from?: string; to?: string }
    const workDir = cwd || process.cwd()
    const files = gitService.getChangedFiles(workDir, from, to)
    res.json({ success: true, data: { files } })
  })

  // ═══════════════ Repo Isolation API (仓库隔离) ═══════════════

  /** 获取 Run 的仓库池 */
  router.get('/repo-pool/:runId', (req, res) => {
    const pool = repoIsolationService.getPool(req.params.runId)
    res.json({ success: true, data: { pool } })
  })

  /** 向仓库池添加仓库 */
  router.post('/repo-pool/:runId', async (req, res) => {
    const { name, url, branch } = req.body
    if (!name || !url) {
      res.status(400).json({ success: false, error: 'name and url are required' })
      return
    }
    try {
      const repo = await repoIsolationService.addRepo(req.params.runId, { name, url, branch })
      res.json({ success: true, data: { repo } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取活跃工作空间列表 */
  router.get('/workspaces', (_req, res) => {
    const workspaces = repoIsolationService.getActiveWorkspaces()
    res.json({ success: true, data: { workspaces } })
  })

  /** 清理 Run 的仓库和工作空间 */
  router.delete('/repo-pool/:runId', async (req, res) => {
    await repoIsolationService.cleanupRun(req.params.runId)
    res.json({ success: true })
  })

  // ═══════════════ Permission 权限管理 API ═══════════════

  /** 设置 Agent 权限策略 */
  router.post('/permissions/policy', (req, res) => {
    const { agentId, runId, repoAccess, filePatterns } = req.body
    if (!agentId || !runId) {
      res.status(400).json({ success: false, error: 'agentId and runId are required' })
      return
    }
    permissionIsolationService.setPolicy({ agentId, runId, repoAccess: repoAccess || [], filePatterns })
    res.json({ success: true })
  })

  /** 获取 Agent 权限策略 */
  router.get('/permissions/policy/:agentId/:runId', (req, res) => {
    const policy = permissionIsolationService.getPolicy(req.params.agentId, req.params.runId)
    res.json({ success: true, data: { policy } })
  })

  /** 权限检查 */
  router.post('/permissions/check', (req, res) => {
    const result = permissionIsolationService.checkAccess(req.body)
    res.json({ success: true, data: result })
  })

  /** 获取审计日志 */
  router.get('/permissions/audit-log', (req, res) => {
    const { runId, agentId, level, limit } = req.query as Record<string, string>
    const log = permissionIsolationService.getAuditLog({
      runId, agentId,
      level: level as 'info' | 'warn' | 'error',
      limit: limit ? parseInt(limit, 10) : undefined,
    })
    res.json({ success: true, data: { log } })
  })

  // ═══════════════ Contract Validation API (产出物合同验证) ═══════════════

  /** 验证节点产出物是否满足合同 */
  router.post('/contracts/validate/:runId/:nodeId', (req, res) => {
    const run = workflowEngine.getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    const node = run.nodes.find(n => n.id === req.params.nodeId)
    if (!node) {
      res.status(404).json({ success: false, error: 'Node not found' })
      return
    }

    // 从模板获取 OutputContracts
    const template = templateService.getTemplate(run.templateId)
    const templateNode = template?.nodes.find(tn => req.params.nodeId.endsWith(tn.id))
    const contracts = templateNode?.outputContracts || []

    const result = contractValidatorService.validate(node.id, contracts, node.artifacts)
    const report = contractValidatorService.formatReport(result)

    res.json({ success: true, data: { result, report } })
  })

  return router
}
