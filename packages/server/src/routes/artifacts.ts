import { Router } from 'express'
import type { ArtifactMergeService } from '../services/artifact-merge.js'
import type { MetricsCollector } from '../services/metrics-collector.js'
import type { FeedbackCollector } from '../services/feedback-collector.js'
import type { WeeklyDigest } from '../services/weekly-digest.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'

export function createArtifactsRouter(deps: {
  artifactMergeService: ArtifactMergeService
  metricsCollector: MetricsCollector
  feedbackCollector: FeedbackCollector
  weeklyDigest: WeeklyDigest
  workflowEngine: WorkflowEngine
}): Router {
  const router = Router()
  const { artifactMergeService, metricsCollector, feedbackCollector, weeklyDigest, workflowEngine } = deps

  // Artifact Merge API

  /** 为节点生成 Diff Review */
  router.post('/diff-review/:runId/:nodeId', (req, res) => {
    const { runId, nodeId } = req.params
    const { turnId } = req.body
    if (!turnId) {
      res.status(400).json({ success: false, error: 'turnId is required' })
      return
    }
    try {
      const review = artifactMergeService.prepareDiffReview({ turnId, nodeId, runId })
      if (!review) {
        res.json({ success: true, data: { review: null, message: 'No worktree workspace found for this turn' } })
        return
      }
      res.json({ success: true, data: { review } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取节点的 Diff Review 列表 */
  router.get('/diff-review/:runId/:nodeId', (req, res) => {
    const { nodeId } = req.params
    try {
      const reviews = artifactMergeService.getNodeReviews(nodeId)
      res.json({ success: true, data: { reviews } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取指定文件的详细 Diff */
  router.get('/diff-review/:runId/:nodeId/:turnId/file', (req, res) => {
    const { turnId } = req.params
    const filePath = req.query.path as string
    if (!filePath) {
      res.status(400).json({ success: false, error: 'path query parameter is required' })
      return
    }
    try {
      const fileDiff = artifactMergeService.getFileDiff(turnId, filePath)
      res.json({ success: true, data: { fileDiff } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** Approve 后合入工作分支 */
  router.post('/merge/:runId/:nodeId', (req, res) => {
    const { turnId, strategy } = req.body
    if (!turnId) {
      res.status(400).json({ success: false, error: 'turnId is required' })
      return
    }
    try {
      const result = artifactMergeService.mergeBranch(turnId, strategy || 'squash')
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** Reject/Skip 时丢弃工作分支 */
  router.post('/discard/:runId/:nodeId', (req, res) => {
    const { turnId } = req.body
    if (!turnId) {
      res.status(400).json({ success: false, error: 'turnId is required' })
      return
    }
    try {
      const result = artifactMergeService.discardBranch(turnId)
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  // Metrics API

  /** 获取 Run 的完整指标 */
  router.get('/metrics/:runId', (req, res) => {
    const { runId } = req.params
    try {
      let metrics = metricsCollector.getRunMetrics(runId)
      if (!metrics) {
        const run = workflowEngine.getRun(runId)
        if (!run) {
          res.status(404).json({ success: false, error: 'Run not found' })
          return
        }
        const allTurns = workflowEngine.getAllTurns()
        metrics = metricsCollector.computeRunMetrics(run, allTurns)
      }
      res.json({ success: true, data: { metrics } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取 Token 分布 */
  router.get('/metrics/:runId/token-distribution', (req, res) => {
    const { runId } = req.params
    try {
      if (!metricsCollector.getRunMetrics(runId)) {
        const run = workflowEngine.getRun(runId)
        if (run) {
          const allTurns = workflowEngine.getAllTurns()
          metricsCollector.computeRunMetrics(run, allTurns)
        }
      }
      const distribution = metricsCollector.getTokenDistribution(runId)
      res.json({ success: true, data: { distribution } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取效率表格 */
  router.get('/metrics/:runId/efficiency', (req, res) => {
    const { runId } = req.params
    try {
      if (!metricsCollector.getRunMetrics(runId)) {
        const run = workflowEngine.getRun(runId)
        if (run) {
          const allTurns = workflowEngine.getAllTurns()
          metricsCollector.computeRunMetrics(run, allTurns)
        }
      }
      const table = metricsCollector.getEfficiencyTable(runId)
      res.json({ success: true, data: { table } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取趋势对比（同 template 多次 Run） */
  router.get('/metrics/trend/:templateId', (req, res) => {
    const { templateId } = req.params
    try {
      const trend = metricsCollector.getTrend(templateId)
      res.json({ success: true, data: { trend } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  // Feedback API

  /** 查询反馈记录 */
  router.post('/feedback', async (req, res) => {
    try {
      const { type, runId, severity, limit } = req.body || {}
      const entries = await feedbackCollector.query({ type, runId, severity, limit })
      res.json({ success: true, data: { entries } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取反馈统计 */
  router.get('/feedback/stats', async (req, res) => {
    try {
      const days = Number(req.query.days) || 7
      const stats = await feedbackCollector.getStats(days)
      res.json({ success: true, data: { stats } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 生成周报摘要 */
  router.post('/feedback/digest', async (req, res) => {
    try {
      const { days } = req.body || {}
      const digest = await weeklyDigest.generate(days || 7)
      res.json({ success: true, data: { digest } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 记录手动备注 */
  router.post('/feedback/note', (req, res) => {
    try {
      const { runId, nodeId, note } = req.body
      if (!note) {
        res.status(400).json({ success: false, error: 'note is required' })
        return
      }
      const entry = feedbackCollector.recordManualNote({ runId, nodeId, note })
      res.json({ success: true, data: { entry } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
