import { Router } from 'express'
import type { L1RuleLifecycleService } from '../services/l1-rule-lifecycle.js'

export function createL1RulesRouter(deps: {
  l1RuleLifecycleService: L1RuleLifecycleService
}): Router {
  const router = Router()
  const { l1RuleLifecycleService } = deps

  /** 获取全局规则统计 */
  router.get('/stats', (_req, res) => {
    try {
      const stats = l1RuleLifecycleService.getStats()
      res.json({ success: true, data: { stats } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取某模板下所有规则 */
  router.get('/template/:templateId', (req, res) => {
    try {
      const rules = l1RuleLifecycleService.getRulesForTemplate(req.params.templateId)
      res.json({ success: true, data: { rules } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取某节点的活跃规则 */
  router.get('/node/:templateId/:nodeName', (req, res) => {
    try {
      const rules = l1RuleLifecycleService.getActiveRulesForNode(
        req.params.templateId,
        decodeURIComponent(req.params.nodeName),
      )
      res.json({ success: true, data: { rules } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 手动激活规则 */
  router.post('/:ruleId/activate', async (req, res) => {
    try {
      const success = await l1RuleLifecycleService.activateRule(req.params.ruleId)
      if (!success) {
        res.status(400).json({ success: false, error: 'Rule cannot be activated (must be draft or decaying)' })
        return
      }
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 手动废弃规则 */
  router.post('/:ruleId/deprecate', async (req, res) => {
    try {
      const { reason } = req.body || {}
      const success = await l1RuleLifecycleService.deprecateRule(
        req.params.ruleId,
        reason || '手动废弃',
      )
      if (!success) {
        res.status(400).json({ success: false, error: 'Rule cannot be deprecated (already archived or deprecated)' })
        return
      }
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
