/**
 * Adversarial / Sub-Turn API 路由
 *
 * 提供对抗审查会话及 Sub-Turn 的查询接口，供前端 Sub-Turn 可视化面板使用。
 *
 * 路由映射：
 *   GET  /sessions/:runId/:nodeId   → 获取节点的所有对抗会话列表
 *   GET  /session/:sessionId        → 获取单个会话详情（含所有 Sub-Turn）
 *   GET  /result/:runId/:nodeId     → 获取节点的对抗结果摘要
 *   GET  /active/:runId/:nodeId     → 获取节点当前活跃的对抗会话
 */

import { Router } from 'express'
import type { AdversarialTurnService } from '../services/adversarial-turn.js'

export function createAdversarialRouter(deps: {
  adversarialTurnService: AdversarialTurnService
}): Router {
  const router = Router()
  const { adversarialTurnService } = deps

  /** 获取节点的所有对抗会话列表 */
  router.get('/sessions/:runId/:nodeId', (req, res) => {
    const { runId, nodeId } = req.params
    const sessions = adversarialTurnService.getNodeSessions(runId, nodeId)
    res.json({
      success: true,
      data: {
        sessions,
        total: sessions.length,
      },
    })
  })

  /** 获取单个会话详情（含所有 Sub-Turn） */
  router.get('/session/:sessionId', (req, res) => {
    const session = adversarialTurnService.getSessionById(req.params.sessionId)
    if (!session) {
      res.status(404).json({ success: false, error: `Session not found: ${req.params.sessionId}` })
      return
    }
    res.json({ success: true, data: { session } })
  })

  /** 获取节点的对抗结果摘要 */
  router.get('/result/:runId/:nodeId', (req, res) => {
    const { runId, nodeId } = req.params
    const result = adversarialTurnService.getAdversarialResult(runId, nodeId)
    res.json({
      success: true,
      data: {
        result: result || null,
        hasResult: !!result,
      },
    })
  })

  /** 获取节点当前活跃的对抗会话 */
  router.get('/active/:runId/:nodeId', (req, res) => {
    const { runId, nodeId } = req.params
    const session = adversarialTurnService.getActiveSession(runId, nodeId)
    res.json({
      success: true,
      data: {
        session: session || null,
        isActive: !!session,
      },
    })
  })

  return router
}
