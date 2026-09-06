import { Router } from 'express'
import type { ArtifactMergeService } from '../services/artifact-merge.js'
import type { MetricsCollector } from '../services/metrics-collector.js'
import type { FeedbackCollector } from '../services/feedback-collector.js'
import type { WeeklyDigest } from '../services/weekly-digest.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { ProjectService } from '../services/project.js'

export function createArtifactsRouter(deps: {
  artifactMergeService: ArtifactMergeService
  metricsCollector: MetricsCollector
  feedbackCollector: FeedbackCollector
  weeklyDigest: WeeklyDigest
  workflowEngine: WorkflowEngine
  projectService: ProjectService
}): Router {
  const router = Router()
  const { artifactMergeService, metricsCollector, feedbackCollector, weeklyDigest, workflowEngine, projectService } = deps

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
    const { runId, nodeId } = req.params
    try {
      const node = workflowEngine.getRun(runId)?.nodes.find(n => n.id === nodeId)
      const turn = workflowEngine.getNodeTurns(nodeId).at(-1)
      if (node && turn && ['wait_user_review', 'completed'].includes(node.status)) {
        artifactMergeService.prepareDiffReview({ runId, nodeId, turnId: turn.id })
      }
      const reviews = artifactMergeService.getNodeReviews(nodeId).filter(review => review.runId === runId)
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
      const review = artifactMergeService.getReview(turnId)
      if (!review || review.runId !== req.params.runId || review.nodeId !== req.params.nodeId) {
        res.status(409).json({ success: false, error: 'Review does not belong to this node; reload the current diff' })
        return
      }
      const result = artifactMergeService.mergeBranch(turnId, strategy || 'squash')
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 创建 GitHub PR（pr 模式） */
  router.post('/create-pr/:runId/:nodeId', async (req, res) => {
    const { turnId, title, body, baseBranch } = req.body
    if (!turnId) {
      res.status(400).json({ success: false, error: 'turnId is required' })
      return
    }
    try {
      const review = artifactMergeService.getReview(turnId)
      if (!review || review.runId !== req.params.runId || review.nodeId !== req.params.nodeId) {
        res.status(409).json({ success: false, error: 'Review does not belong to this node; reload the current diff' })
        return
      }
      const result = await artifactMergeService.pushAndCreatePR(turnId, { title, body, baseBranch })
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 查询 PR 状态 */
  router.get('/pr-status/:owner/:repo/:prNumber', async (req, res) => {
    const { owner, repo, prNumber } = req.params
    try {
      const status = await artifactMergeService.getPRStatus(owner, repo, parseInt(prNumber, 10))
      if (!status) {
        res.status(404).json({ success: false, error: 'PR not found or not authenticated' })
        return
      }
      res.json({ success: true, data: status })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取项目的合并模式 */
  router.get('/merge-mode/:projectId', (req, res) => {
    const project = projectService.getProject(req.params.projectId)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true, data: { mergeMode: project.mergeMode || 'local' } })
  })

  /** 检测仓库类型（团队 / 个人） */
  router.get('/detect-repo-type/:projectId', async (req, res) => {
    const project = projectService.getProject(req.params.projectId)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    try {
      let detection
      const repoUrl = project.contextConfig?.repoUrl
      if (repoUrl) {
        detection = await artifactMergeService.detectRepoTypeByUrl(repoUrl)
      } else if (project.path) {
        detection = await artifactMergeService.detectRepoType(project.path)
      } else {
        res.status(400).json({ success: false, error: 'Project has no repoUrl or local path configured' })
        return
      }
      res.json({ success: true, data: detection })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 检测并自动设置 mergeMode（团队项目强制 PR 模式） */
  router.post('/detect-and-set-merge-mode/:projectId', async (req, res) => {
    const project = projectService.getProject(req.params.projectId)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    try {
      let detection
      const repoUrl = project.contextConfig?.repoUrl
      if (repoUrl) {
        detection = await artifactMergeService.detectRepoTypeByUrl(repoUrl)
      } else if (project.path) {
        detection = await artifactMergeService.detectRepoType(project.path)
      } else {
        res.status(400).json({ success: false, error: 'Project has no repoUrl or local path configured' })
        return
      }

      // 团队项目强制 PR 模式
      if (detection.repoType === 'team') {
        await projectService.updateProject(project.id, { mergeMode: 'pr' })
      } else if (!project.mergeMode) {
        // 个人项目且未设置过，设为建议值
        await projectService.updateProject(project.id, { mergeMode: detection.suggestedMergeMode })
      }

      res.json({
        success: true,
        data: {
          ...detection,
          applied: true,
          mergeMode: detection.repoType === 'team' ? 'pr' : (project.mergeMode || detection.suggestedMergeMode),
          locked: detection.repoType === 'team', // 团队项目锁定为 PR 模式
        },
      })
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
      const review = artifactMergeService.getReview(turnId)
      if (!review || review.runId !== req.params.runId || review.nodeId !== req.params.nodeId) {
        res.status(409).json({ success: false, error: 'Review does not belong to this node; reload the current diff' })
        return
      }
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

  /** 语义聚合反馈 — 按类别分组、优先级排序、urgency 标记 */
  router.post('/feedback/aggregate', async (req, res) => {
    try {
      const { days = 14, runId } = req.body || {}
      const entries = await feedbackCollector.query({
        startTime: Date.now() - days * 24 * 60 * 60 * 1000,
        endTime: Date.now(),
        runId,
      })

      // 按 type + severity 分组聚合
      interface AggCluster {
        category: string
        categoryLabel: string
        severity: string
        urgency: 'critical' | 'high' | 'normal' | 'low'
        count: number
        entries: typeof entries
        topPatterns: Array<{ pattern: string; count: number }>
        latestTimestamp: number
        affectedNodes: string[]
      }

      const typeLabels: Record<string, string> = {
        review_reject: '审批打回',
        diff_discard: 'Diff 丢弃',
        execution_failure: '执行失败',
        validation_failure: '验证失败',
        manual_note: '手动备注',
      }

      // Group by type
      const typeGroups = new Map<string, typeof entries>()
      for (const entry of entries) {
        const key = entry.type
        const group = typeGroups.get(key) || []
        group.push(entry)
        typeGroups.set(key, group)
      }

      const clusters: AggCluster[] = []

      for (const [type, group] of typeGroups) {
        // Sub-group by severity
        const severityGroups = new Map<string, typeof entries>()
        for (const entry of group) {
          const key = entry.severity
          const sg = severityGroups.get(key) || []
          sg.push(entry)
          severityGroups.set(key, sg)
        }

        for (const [severity, severityGroup] of severityGroups) {
          // Extract pattern by summary similarity (simple word-level)
          const patternCounts = new Map<string, number>()
          const affectedNodesSet = new Set<string>()
          let latestTs = 0

          for (const entry of severityGroup) {
            // Use summary as pattern key (truncated for grouping)
            const pattern = entry.summary.slice(0, 100)
            patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1)
            if (entry.nodeName) affectedNodesSet.add(entry.nodeName)
            if (entry.timestamp > latestTs) latestTs = entry.timestamp
          }

          const topPatterns = Array.from(patternCounts.entries())
            .map(([pattern, count]) => ({ pattern, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)

          // Compute urgency based on severity + recency + frequency
          const hoursSinceLatest = (Date.now() - latestTs) / (1000 * 60 * 60)
          let urgency: AggCluster['urgency'] = 'normal'
          if (severity === 'critical' || (severity === 'high' && severityGroup.length >= 3)) {
            urgency = 'critical'
          } else if (severity === 'high' || (severity === 'medium' && severityGroup.length >= 5) || hoursSinceLatest < 2) {
            urgency = 'high'
          } else if (severity === 'low' && severityGroup.length <= 1) {
            urgency = 'low'
          }

          clusters.push({
            category: type,
            categoryLabel: typeLabels[type] || type,
            severity,
            urgency,
            count: severityGroup.length,
            entries: severityGroup,
            topPatterns,
            latestTimestamp: latestTs,
            affectedNodes: Array.from(affectedNodesSet),
          })
        }
      }

      // Sort by urgency priority then count
      const urgencyOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }
      clusters.sort((a, b) => {
        const urgDiff = (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2)
        if (urgDiff !== 0) return urgDiff
        return b.count - a.count
      })

      // Summary stats
      const totalEntries = entries.length
      const criticalCount = clusters.filter(c => c.urgency === 'critical').reduce((s, c) => s + c.count, 0)
      const highCount = clusters.filter(c => c.urgency === 'high').reduce((s, c) => s + c.count, 0)

      res.json({
        success: true,
        data: {
          summary: {
            totalEntries,
            clusterCount: clusters.length,
            criticalCount,
            highCount,
            periodDays: days,
          },
          clusters: clusters.map(c => ({
            category: c.category,
            categoryLabel: c.categoryLabel,
            severity: c.severity,
            urgency: c.urgency,
            count: c.count,
            topPatterns: c.topPatterns,
            latestTimestamp: c.latestTimestamp,
            affectedNodes: c.affectedNodes,
          })),
        },
      })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
