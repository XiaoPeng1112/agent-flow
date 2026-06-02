import { Router } from 'express'
import type { ContextDBService } from '../services/context-db.js'

export function createContextRouter(deps: {
  contextDBService: ContextDBService
}): Router {
  const router = Router()
  const { contextDBService } = deps

  // ═══════════════ Context DB API (四层上下文数据库) ═══════════════

  /** 获取 Context DB 统计 */
  router.get('/stats', async (_req, res) => {
    try {
      const stats = await contextDBService.getStats()
      res.json({ success: true, data: stats })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 按 runId 批量列出该 Run 所有节点的 L2 文件 */
  router.get('/L2-by-run/:runId', async (req, res) => {
    const { runId } = req.params
    try {
      const files = await contextDBService.listL2FilesByRunId(runId)
      res.json({ success: true, data: { files } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 列出某层级某 scope 下的所有上下文文件 */
  router.get('/:level/:scopeId', async (req, res) => {
    const { level, scopeId } = req.params
    try {
      const files = await contextDBService.listContextFiles(level as any, scopeId)
      res.json({ success: true, data: { files } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 读取上下文文件内容 */
  router.get('/:level/:scopeId/:filename', async (req, res) => {
    const { level, scopeId, filename } = req.params
    try {
      const content = await contextDBService.getContext(level as any, scopeId, filename)
      if (content === null) {
        res.status(404).json({ success: false, error: 'Context file not found' })
        return
      }
      res.json({ success: true, data: { content, level, scopeId, filename } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 创建/更新上下文文件 */
  router.put('/:level/:scopeId/:filename', async (req, res) => {
    const { level, scopeId, filename } = req.params
    const { content } = req.body
    if (!content && content !== '') {
      res.status(400).json({ success: false, error: 'content is required in body' })
      return
    }
    try {
      const result = await contextDBService.upsertContext(level as any, scopeId, filename, content)
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 删除上下文文件 */
  router.delete('/:level/:scopeId/:filename', async (req, res) => {
    const { level, scopeId, filename } = req.params
    try {
      const deleted = await contextDBService.deleteContext(level as any, scopeId, filename)
      res.json({ success: true, data: { deleted } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 装配上下文（按 SYS→L0→L1→L2 顺序聚合） */
  router.post('/assemble', async (req, res) => {
    const { projectId, templateId, nodeId } = req.body
    try {
      const layers = await contextDBService.assembleContext({ projectId, templateId, nodeId })
      const formatted = contextDBService.formatAssembledContext(layers)
      res.json({ success: true, data: { layers, formatted, totalLayers: layers.length } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
