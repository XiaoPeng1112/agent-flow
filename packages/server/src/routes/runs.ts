import { Router } from 'express'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { TemplateService } from '../services/template.js'

export function createRunsRouter(deps: {
  workflowEngine: WorkflowEngine
  templateService: TemplateService
}): Router {
  const router = Router()
  const { workflowEngine, templateService } = deps

  // ═══════════════ Run API ═══════════════

  /** 获取项目的所有 Runs */
  router.get('/', (req, res) => {
    const projectId = req.query.projectId as string | undefined
    const runs = workflowEngine.getRuns(projectId)
    res.json({ success: true, data: { runs } })
  })

  /** 获取单个 Run 详情 */
  router.get('/:id', (req, res) => {
    const run = workflowEngine.getRun(req.params.id)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    res.json({ success: true, data: { run } })
  })

  /** 创建 Run（从模板实例化） */
  router.post('/', async (req, res) => {
    const { projectId, templateId, name } = req.body
    if (!projectId || !templateId) {
      res.status(400).json({ success: false, error: 'projectId and templateId are required' })
      return
    }

    const template = templateService.getTemplate(templateId)
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' })
      return
    }

    const run = await workflowEngine.createRun(projectId, template, name)
    res.json({ success: true, data: { run } })
  })

  /** 启动 Run */
  router.post('/:id/start', async (req, res) => {
    try {
      const run = await workflowEngine.startRun(req.params.id)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 暂停 Run */
  router.post('/:id/pause', async (req, res) => {
    try {
      const run = await workflowEngine.pauseRun(req.params.id)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 恢复 Run */
  router.post('/:id/resume', async (req, res) => {
    try {
      const run = await workflowEngine.resumeRun(req.params.id)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 删除 Run */
  router.delete('/:id', async (req, res) => {
    const success = await workflowEngine.deleteRun(req.params.id)
    if (!success) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    res.json({ success: true })
  })

  /** 获取 Run 的 Token 消耗统计 */
  router.get('/:id/token-stats', (req, res) => {
    try {
      const stats = workflowEngine.getRunTokenStats(req.params.id)
      res.json({ success: true, data: stats })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  /** 更新 Run 配置（自动执行、并行度等） */
  router.patch('/:runId/config', async (req, res) => {
    try {
      await workflowEngine.updateRunConfig(req.params.runId, req.body)
      res.json({ success: true })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  // ═══════════════ Node API ═══════════════

  /** 启动节点（ready → running） */
  router.post('/:runId/nodes/:nodeId/start', async (req, res) => {
    try {
      const node = await workflowEngine.startNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 提交节点决策 */
  router.post('/:runId/nodes/:nodeId/submit', async (req, res) => {
    const { decision, error } = req.body
    try {
      const node = await workflowEngine.submitNodeDecision(req.params.runId, req.params.nodeId, decision, error)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 用户确认节点（wait_user_review → completed），可附带修改意见 */
  router.post('/:runId/nodes/:nodeId/approve', async (req, res) => {
    const { feedback } = req.body || {}
    try {
      const node = await workflowEngine.approveNode(req.params.runId, req.params.nodeId, feedback)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 用户打回节点（wait_user_review → running） */
  router.post('/:runId/nodes/:nodeId/reject', async (req, res) => {
    const { feedback } = req.body
    try {
      const node = await workflowEngine.rejectNode(req.params.runId, req.params.nodeId, feedback)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 跳过节点 */
  router.post('/:runId/nodes/:nodeId/skip', async (req, res) => {
    try {
      const node = await workflowEngine.skipNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 回滚节点 */
  router.post('/:runId/nodes/:nodeId/rollback', async (req, res) => {
    try {
      await workflowEngine.rollbackNode(req.params.runId, req.params.nodeId)
      const run = workflowEngine.getRun(req.params.runId)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 强制重置节点（running → ready，用于卡住的节点） */
  router.post('/:runId/nodes/:nodeId/force-reset', async (req, res) => {
    try {
      const node = await workflowEngine.forceResetNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 更新节点绑定的 Skills */
  router.patch('/:runId/nodes/:nodeId/skills', async (req, res) => {
    const { skillIds } = req.body
    if (!Array.isArray(skillIds)) {
      res.status(400).json({ success: false, error: 'skillIds must be an array' })
      return
    }
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
    node.skillIds = skillIds
    await workflowEngine.persist()
    res.json({ success: true, data: { node } })
  })

  /** 获取节点产出物 */
  router.get('/:runId/nodes/:nodeId/artifacts', (req, res) => {
    const artifacts = workflowEngine.getNodeArtifacts(req.params.runId, req.params.nodeId)
    res.json({ success: true, data: { artifacts } })
  })

  /** 添加节点产出物 */
  router.post('/:runId/nodes/:nodeId/artifacts', async (req, res) => {
    try {
      const artifact = await workflowEngine.addArtifact(req.params.runId, req.params.nodeId, req.body)
      res.json({ success: true, data: { artifact } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
