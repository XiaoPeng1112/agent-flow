import { Router } from 'express'
import type { RobustnessService } from '../services/robustness.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'

export function createRobustnessRouter(deps: {
  robustnessService: RobustnessService
  workflowEngine: WorkflowEngine
}): Router {
  const router = Router()
  const { robustnessService, workflowEngine } = deps

  // ═══════════════ Robustness API (健壮性) ═══════════════

  /** 获取系统健康状态 */
  router.get('/health', (_req, res) => {
    const health = robustnessService.getHealthStatus()
    res.json({ success: true, data: health })
  })

  /** 获取死信队列 */
  router.get('/dead-letter', (req, res) => {
    const runId = req.query.runId as string | undefined
    const queue = robustnessService.getDeadLetterQueue(runId)
    res.json({ success: true, data: { queue } })
  })

  /** 解决死信项 */
  router.post('/dead-letter/:itemId/resolve', (req, res) => {
    const { resolution } = req.body
    const ok = robustnessService.resolveDeadLetter(req.params.itemId, resolution)
    res.json({ success: ok })
  })

  /** 获取 Checkpoint 列表 */
  router.get('/checkpoints/:runId', (req, res) => {
    const checkpoints = robustnessService.getCheckpoints(req.params.runId)
    res.json({ success: true, data: { checkpoints } })
  })

  /** 创建 Checkpoint */
  router.post('/checkpoints/:runId', (req, res) => {
    const run = workflowEngine.getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    const checkpoint = robustnessService.createCheckpoint(run, req.body.description)
    res.json({ success: true, data: { checkpoint } })
  })

  /** 恢复到指定 Checkpoint */
  router.post('/checkpoints/:runId/restore/:checkpointId', async (req, res) => {
    const run = workflowEngine.getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    const states = robustnessService.getCheckpointStates(req.params.checkpointId)
    if (!states) {
      res.status(404).json({ success: false, error: 'Checkpoint not found' })
      return
    }
    try {
      await workflowEngine.restoreFromCheckpoint(run.id, states)
      const updatedRun = workflowEngine.getRun(run.id)
      res.json({ success: true, data: { run: updatedRun } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 查询审计日志 */
  router.get('/audit-log', (req, res) => {
    const { runId, nodeId, action, level, limit } = req.query as Record<string, string>
    const log = robustnessService.queryAuditLog({
      runId, nodeId, action,
      level: level as 'info' | 'warn' | 'error',
      limit: limit ? parseInt(limit, 10) : undefined,
    })
    res.json({ success: true, data: { log } })
  })

  return router
}
