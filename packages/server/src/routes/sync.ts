import { Router } from 'express'
import type { SyncService } from '../services/sync.js'

export function createSyncRouter(deps: {
  syncService: SyncService
}): Router {
  const router = Router()
  const { syncService } = deps

  // Sync API (GitHub 数据同步)

  /** 获取同步状态 */
  router.get('/status', (_req, res) => {
    const status = syncService.getStatus()
    res.json({ success: true, data: status })
  })

  /** 获取同步配置 */
  router.get('/config', (_req, res) => {
    const config = syncService.getConfig()
    res.json({ success: true, data: { config } })
  })

  /** 配置同步（设置远端仓库） */
  router.post('/config', async (req, res) => {
    const { repoFullName, autoSync } = req.body
    if (!repoFullName) {
      res.status(400).json({ success: false, error: 'repoFullName is required' })
      return
    }
    try {
      const config = await syncService.configure(repoFullName, autoSync !== false)
      res.json({ success: true, data: { config } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 更新自动同步开关 */
  router.patch('/config', async (req, res) => {
    const { autoSync } = req.body
    if (autoSync === undefined) {
      res.status(400).json({ success: false, error: 'autoSync is required' })
      return
    }
    try {
      await syncService.setAutoSync(autoSync)
      res.json({ success: true })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 断开同步 */
  router.delete('/config', async (_req, res) => {
    try {
      await syncService.disconnect()
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 推送本地数据到远端 */
  router.post('/push', async (_req, res) => {
    try {
      const result = await syncService.push()
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 从远端拉取数据到本地 */
  router.post('/pull', async (_req, res) => {
    try {
      const result = await syncService.pull()
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 从 v1 结构迁移到 v2 多用户结构 */
  router.post('/migrate', async (_req, res) => {
    try {
      const result = await syncService.migrateFromV1()
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 推送共享资源到 shared/ 目录 */
  router.post('/push-shared', async (req, res) => {
    try {
      const { templates, contextFiles } = req.body || {}
      const result = await syncService.pushSharedResources({ templates, contextFiles })
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 列出仓库中所有用户 */
  router.get('/users', async (_req, res) => {
    try {
      const users = await syncService.listUsers()
      res.json({ success: true, data: users })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 创建同步专用私有仓库 */
  router.post('/create-repo', async (req, res) => {
    const { repoName } = req.body
    if (!repoName) {
      res.status(400).json({ success: false, error: 'repoName is required' })
      return
    }
    try {
      const result = await syncService.createSyncRepo(repoName)
      res.json({ success: true, data: result })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取远端项目列表及匹配状态 */
  router.get('/remote-projects', async (_req, res) => {
    try {
      const projects = await syncService.getRemoteProjects()
      res.json({ success: true, data: { projects } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取当前路径映射配置 */
  router.get('/path-mapping', (_req, res) => {
    const mapping = syncService.getPathMapping()
    res.json({ success: true, data: { mapping } })
  })

  /** 设置项目路径映射 */
  router.post('/path-mapping', async (req, res) => {
    const { mapping, merge } = req.body
    if (!mapping || typeof mapping !== 'object') {
      res.status(400).json({ success: false, error: 'mapping is required and must be an object like { "proj_id": "/local/path" }' })
      return
    }
    try {
      const result = await syncService.setPathMapping(mapping, merge !== false)
      res.json({ success: true, data: { mapping: result } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 删除单个路径映射 */
  router.delete('/path-mapping/:projectId', async (req, res) => {
    try {
      await syncService.removePathMapping(req.params.projectId)
      res.json({ success: true })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
