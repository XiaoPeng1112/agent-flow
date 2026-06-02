import { Router } from 'express'
import type { ProjectService } from '../services/project.js'
import type { AgentService } from '../services/agent.js'
import type { TemplateService } from '../services/template.js'

export function createProjectsRouter(deps: {
  projectService: ProjectService
  agentService: AgentService
  templateService: TemplateService
}): Router {
  const router = Router()
  const { projectService, agentService, templateService } = deps

  // ═══════════════ Project API ═══════════════

  router.get('/', (_req, res) => {
    res.json({ success: true, data: { projects: projectService.getProjects() } })
  })

  router.post('/', async (req, res) => {
    const { name, path, description, contextConfig } = req.body
    if (!name || !path) {
      res.status(400).json({ success: false, error: 'name and path are required' })
      return
    }
    try {
      const project = await projectService.addProject({ name, path, description, contextConfig })
      res.json({ success: true, data: { project } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  router.put('/:id', async (req, res) => {
    const { name, description, contextConfig, enabledAgentIds } = req.body
    const project = await projectService.updateProject(req.params.id, { name, description, contextConfig, enabledAgentIds })
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true, data: { project } })
  })

  router.delete('/:id', async (req, res) => {
    const success = await projectService.removeProject(req.params.id)
    if (!success) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true })
  })

  router.get('/:id/skills', async (req, res) => {
    try {
      const skills = await projectService.scanProjectSkills(req.params.id)
      res.json({ success: true, data: { skills } })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  /** 更新项目启用的 Agent 列表 */
  router.put('/:id/enabled-agents', async (req, res) => {
    const { enabledAgentIds } = req.body
    if (!Array.isArray(enabledAgentIds)) {
      res.status(400).json({ success: false, error: 'enabledAgentIds must be an array' })
      return
    }
    const project = await projectService.updateProject(req.params.id, { enabledAgentIds })
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true, data: { project } })
  })

  /** 获取项目启用的 Agent 列表 */
  router.get('/:id/enabled-agents', (req, res) => {
    const project = projectService.getProject(req.params.id)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    // 未配置时返回全部 Agent（默认全部启用）
    const allAgentIds = agentService.getAgents().map(a => a.id)
    const enabledAgentIds = project.enabledAgentIds ?? allAgentIds
    res.json({ success: true, data: { enabledAgentIds, allAgentIds } })
  })

  // ═══════════════ Template API ═══════════════

  router.get('/templates', (_req, res) => {
    res.json({ success: true, data: { templates: templateService.getTemplates() } })
  })

  router.get('/templates/:id', (req, res) => {
    const template = templateService.getTemplate(req.params.id)
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' })
      return
    }
    res.json({ success: true, data: { template } })
  })

  router.post('/templates', async (req, res) => {
    try {
      const template = await templateService.createTemplate(req.body)
      res.json({ success: true, data: { template } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  router.delete('/templates/:id', async (req, res) => {
    const success = await templateService.deleteTemplate(req.params.id)
    if (!success) {
      res.status(400).json({ success: false, error: 'Cannot delete default template' })
      return
    }
    res.json({ success: true })
  })

  return router
}
