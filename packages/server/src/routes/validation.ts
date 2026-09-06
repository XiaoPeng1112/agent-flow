import { Router } from 'express'
import type { ValidationTurnService } from '../services/validation-turn.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'

export function createValidationRouter(deps: {
  validationTurnService: ValidationTurnService
  workflowEngine: WorkflowEngine
}): Router {
  const router = Router()
  const { validationTurnService, workflowEngine } = deps

  /** 获取节点的验证结果（如果有） */
  router.get('/:runId/:nodeId', (req, res) => {
    const { runId, nodeId } = req.params
    const result = validationTurnService.getValidationResult(runId, nodeId)
    if (!result) {
      res.json({ success: true, data: { result: null } })
      return
    }
    res.json({ success: true, data: { result } })
  })

  /** 获取整个 Run 所有节点的验证结果汇总 */
  router.get('/:runId', (req, res) => {
    const { runId } = req.params
    const run = workflowEngine.getRun(runId)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }

    const results: Array<{
      nodeId: string
      nodeName: string
      nodeType: string
      result: ReturnType<typeof validationTurnService.getValidationResult> | null
    }> = []

    for (const node of run.nodes) {
      const result = validationTurnService.getValidationResult(runId, node.id)
      results.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          result: result || null,
        })
    }

    const totalValidated = results.filter(r => r.result !== null).length
    const passed = results.filter(r => r.result?.passed).length
    const failed = results.filter(r => r.result && !r.result.passed).length
    const avgScore = totalValidated > 0
      ? results.reduce((sum, r) => sum + (r.result?.score ?? 0), 0) / totalValidated
      : 0

    res.json({
      success: true,
      data: {
        summary: {
          totalValidated,
          passed,
          failed,
          averageScore: Math.round(avgScore * 100) / 100,
        },
        results,
      },
    })
  })

  /** 手动触发节点验证 */
  router.post('/:runId/:nodeId/trigger', async (req, res) => {
    const { runId, nodeId } = req.params
    try {
      const result = await validationTurnService.validate(runId, nodeId)
      res.json({ success: true, data: { result } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
