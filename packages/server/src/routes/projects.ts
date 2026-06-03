import { Router } from 'express'
import type { ProjectService } from '../services/project.js'
import type { AgentService } from '../services/agent.js'
import type { TemplateService } from '../services/template.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { MetricsCollector } from '../services/metrics-collector.js'
import type { ContextDBService } from '../services/context-db.js'

export function createProjectsRouter(deps: {
  projectService: ProjectService
  agentService: AgentService
  templateService: TemplateService
  workflowEngine?: WorkflowEngine
  metricsCollector?: MetricsCollector
  contextDBService?: ContextDBService
}): Router {
  const router = Router()
  const { projectService, agentService, templateService, workflowEngine, contextDBService } = deps

  // ═══════════════ Project API ═══════════════

  router.get('/', (_req, res) => {
    res.json({ success: true, data: { projects: projectService.getProjects() } })
  })

  router.post('/', async (req, res) => {
    const { name, path, description, contextConfig } = req.body
    if (!name || !path) {
      res.status(400).json({ success: false, error: 'name and path are required' })
      return
    }
    try {
      const project = await projectService.addProject({ name, path, description, contextConfig })
      res.json({ success: true, data: { project } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  router.put('/:id', async (req, res) => {
    const { name, description, contextConfig, enabledAgentIds, mergeMode, defaultExecutionMode } = req.body
    const project = await projectService.updateProject(req.params.id, { name, description, contextConfig, enabledAgentIds, mergeMode, defaultExecutionMode })
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true, data: { project } })
  })

  router.delete('/:id', async (req, res) => {
    if (workflowEngine) {
      const projectRuns = workflowEngine.getRuns(req.params.id)
      for (const run of projectRuns) {
        await workflowEngine.deleteRun(run.id)
      }
    }

    const success = await projectService.removeProject(req.params.id)
    if (!success) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true })
  })

  router.get('/:id/skills', async (req, res) => {
    try {
      const skills = await projectService.scanProjectSkills(req.params.id)
      res.json({ success: true, data: { skills } })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  /** 更新项目启用的 Agent 列表 */
  router.put('/:id/enabled-agents', async (req, res) => {
    const { enabledAgentIds } = req.body
    if (!Array.isArray(enabledAgentIds)) {
      res.status(400).json({ success: false, error: 'enabledAgentIds must be an array' })
      return
    }
    const project = await projectService.updateProject(req.params.id, { enabledAgentIds })
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true, data: { project } })
  })

  /** 获取项目启用的 Agent 列表 */
  router.get('/:id/enabled-agents', (req, res) => {
    const project = projectService.getProject(req.params.id)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    // 未配置时返回全部 Agent（默认全部启用）
    const allAgentIds = agentService.getAgents().map(a => a.id)
    const enabledAgentIds = project.enabledAgentIds ?? allAgentIds
    res.json({ success: true, data: { enabledAgentIds, allAgentIds } })
  })

  // ═══════════════ Project Stats API (项目统计) ═══════════════

  /** 获取项目运行统计概览 */
  router.get('/:id/stats', (req, res) => {
    const project = projectService.getProject(req.params.id)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }

    if (!workflowEngine) {
      res.status(501).json({ success: false, error: 'WorkflowEngine not available' })
      return
    }

    const runs = workflowEngine.getRuns(req.params.id)
    const totalRuns = runs.length
    const completedRuns = runs.filter(r => r.status === 'completed').length
    const failedRuns = runs.filter(r => r.status === 'failed').length
    const runningRuns = runs.filter(r => r.status === 'running').length

    // 计算总 token 使用量（从 runs 的 nodes → turns 聚合）
    let totalTokens = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalNodes = 0
    let completedNodes = 0

    for (const run of runs) {
      totalNodes += run.nodes.length
      completedNodes += run.nodes.filter(n => n.status === 'completed').length

      // 聚合 token 统计
      try {
        const tokenStats = workflowEngine.getRunTokenStats(run.id)
        totalInputTokens += tokenStats.totalInput
        totalOutputTokens += tokenStats.totalOutput
        totalTokens += tokenStats.totalTokens
      } catch {
        // 单个 run 获取失败不影响整体
      }
    }

    // 计算成功率
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0

    // 计算平均耗时（仅完成的 Runs）
    let avgDuration = 0
    const completedRunsWithTime = runs.filter(r => r.status === 'completed' && r.startedAt && r.completedAt)
    if (completedRunsWithTime.length > 0) {
      const totalDuration = completedRunsWithTime.reduce((sum, r) => sum + ((r.completedAt || 0) - (r.startedAt || 0)), 0)
      avgDuration = Math.round(totalDuration / completedRunsWithTime.length)
    }

    // 最近活动时间
    const lastRunAt = runs.length > 0 ? Math.max(...runs.map(r => r.createdAt)) : null

    res.json({
      success: true,
      data: {
        totalRuns,
        completedRuns,
        failedRuns,
        runningRuns,
        successRate,
        totalNodes,
        completedNodes,
        totalTokens,
        totalInputTokens,
        totalOutputTokens,
        avgDuration,
        lastRunAt,
      },
    })
  })

  /** 获取项目的 Token 使用趋势（按天聚合） */
  router.get('/:id/token-trend', (req, res) => {
    const project = projectService.getProject(req.params.id)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }

    if (!workflowEngine) {
      res.status(501).json({ success: false, error: 'WorkflowEngine not available' })
      return
    }

    const days = parseInt(req.query.days as string) || 14
    const runs = workflowEngine.getRuns(req.params.id)
    const now = Date.now()
    const cutoff = now - days * 24 * 60 * 60 * 1000

    // 按天分组
    const dailyData: Record<string, { runs: number; tokens: number; date: string }> = {}

    for (const run of runs) {
      if (run.createdAt < cutoff) continue
      const date = new Date(run.createdAt).toISOString().slice(0, 10)
      if (!dailyData[date]) {
        dailyData[date] = { runs: 0, tokens: 0, date }
      }
      dailyData[date].runs++
    }

    // 填充空白天数
    const trend = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000)
      const date = d.toISOString().slice(0, 10)
      trend.push(dailyData[date] || { runs: 0, tokens: 0, date })
    }

    res.json({ success: true, data: { trend, days } })
  })

  // ═══════════════ Project Data Management API ═══════════════

  /** 导出项目数据（JSON 快照） */
  router.post('/:id/export', (req, res) => {
    const project = projectService.getProject(req.params.id)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }

    if (!workflowEngine) {
      res.status(501).json({ success: false, error: 'WorkflowEngine not available' })
      return
    }

    const includeRuns = req.body.includeRuns !== false

    const exportData: any = {
      version: '1.0',
      exportedAt: Date.now(),
      project: { ...project },
    }

    if (includeRuns) {
      exportData.runs = workflowEngine.getRuns(req.params.id)
    }

    res.json({ success: true, data: exportData })
  })

  /** 批量删除项目的 Runs */
  router.post('/:id/cleanup-runs', async (req, res) => {
    const project = projectService.getProject(req.params.id)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }

    if (!workflowEngine) {
      res.status(501).json({ success: false, error: 'WorkflowEngine not available' })
      return
    }

    const { olderThanDays, status, runIds } = req.body
    const runs = workflowEngine.getRuns(req.params.id)
    let toDelete: string[] = []

    if (Array.isArray(runIds) && runIds.length > 0) {
      // 明确指定要删除的 Run IDs
      toDelete = runIds.filter((id: string) => runs.some(r => r.id === id))
    } else {
      // 按条件筛选
      const cutoff = olderThanDays ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : 0
      for (const run of runs) {
        if (status && run.status !== status) continue
        if (cutoff && run.createdAt > cutoff) continue
        // 不删除正在运行的
        if (run.status === 'running') continue
        toDelete.push(run.id)
      }
    }

    let deleted = 0
    for (const runId of toDelete) {
      const success = await workflowEngine.deleteRun(runId)
      if (success) deleted++
    }

    res.json({ success: true, data: { deleted, total: toDelete.length } })
  })

  // ═══════════════ Context Template API (上下文模板) ═══════════════

  /** 获取项目的上下文装配预览 */
  router.post('/:id/context-preview', async (req, res) => {
    const project = projectService.getProject(req.params.id)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }

    if (!contextDBService) {
      res.status(501).json({ success: false, error: 'ContextDBService not available' })
      return
    }

    const { templateId, nodeId } = req.body
    try {
      const layers = await contextDBService.assembleContext({
        projectId: req.params.id,
        templateId,
        nodeId,
      })
      const formatted = contextDBService.formatAssembledContext(layers)
      res.json({
        success: true,
        data: {
          layers,
          formatted,
          totalLayers: layers.length,
          totalChars: formatted.length,
        },
      })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  // ═══════════════ Template API ═══════════════

  router.get('/templates', (_req, res) => {
    res.json({ success: true, data: { templates: templateService.getTemplates() } })
  })

  router.get('/templates/:id', (req, res) => {
    const template = templateService.getTemplate(req.params.id)
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' })
      return
    }
    res.json({ success: true, data: { template } })
  })

  router.post('/templates', async (req, res) => {
    try {
      const template = await templateService.createTemplate(req.body)
      res.json({ success: true, data: { template } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  router.delete('/templates/:id', async (req, res) => {
    const success = await templateService.deleteTemplate(req.params.id)
    if (!success) {
      res.status(400).json({ success: false, error: 'Cannot delete default template' })
      return
    }
    res.json({ success: true })
  })

  return router
}
