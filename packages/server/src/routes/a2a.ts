import { Router } from 'express'
import type { A2AProtocolService } from '../services/a2a-protocol.js'

export function createA2ARouter(deps: {
  a2aProtocolService: A2AProtocolService
}): Router {
  const router = Router()
  const { a2aProtocolService } = deps

  // ═══════════════ A2A Protocol API (Agent 间通信) ═══════════════

  /** 发送 A2A 消息 */
  router.post('/send', (req, res) => {
    const { fromAgentId, toAgentId, runId, nodeId, type, payload, priority, requiresAck } = req.body
    if (!fromAgentId || !toAgentId || !runId || !nodeId || !type) {
      res.status(400).json({ success: false, error: 'fromAgentId, toAgentId, runId, nodeId, and type are required' })
      return
    }
    try {
      const message = a2aProtocolService.send({ fromAgentId, toAgentId, runId, nodeId, type, payload, priority, requiresAck })
      res.json({ success: true, data: { message } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 委派任务 */
  router.post('/delegate', (req, res) => {
    const { fromAgentId, toAgentId, runId, nodeId, task, priority } = req.body
    try {
      const message = a2aProtocolService.delegateTask({ fromAgentId, toAgentId, runId, nodeId, task, priority })
      res.json({ success: true, data: { message } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取 Agent 收件箱 */
  router.get('/inbox/:agentId', (req, res) => {
    const { status, type, runId } = req.query as Record<string, string>
    const messages = a2aProtocolService.getInbox(req.params.agentId, {
      status: status as any, type: type as any, runId,
    })
    res.json({ success: true, data: { messages } })
  })

  /** 拉取下一条待处理消息 */
  router.post('/pull/:agentId', (req, res) => {
    const message = a2aProtocolService.pullNext(req.params.agentId)
    res.json({ success: true, data: { message } })
  })

  /** 确认消息 */
  router.post('/ack/:messageId', (req, res) => {
    const ok = a2aProtocolService.acknowledge(req.params.messageId)
    res.json({ success: ok })
  })

  /** 解决消息 */
  router.post('/resolve/:messageId', (req, res) => {
    const ok = a2aProtocolService.resolve(req.params.messageId, req.body.result)
    res.json({ success: ok })
  })

  /** 获取 A2A 统计 */
  router.get('/stats', (req, res) => {
    const runId = req.query.runId as string | undefined
    const stats = a2aProtocolService.getStats(runId)
    res.json({ success: true, data: stats })
  })

  /** 创建通信通道 */
  router.post('/channels', (req, res) => {
    const { runId, participants } = req.body
    const channel = a2aProtocolService.createChannel(runId, participants)
    res.json({ success: true, data: { channel } })
  })

  /** 获取 Run 的所有消息 */
  router.get('/messages/:runId', (req, res) => {
    const messages = a2aProtocolService.getRunMessages(req.params.runId)
    res.json({ success: true, data: { messages } })
  })

  return router
}
