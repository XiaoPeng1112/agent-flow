import { Router } from 'express'
import type { AgentService } from '../services/agent.js'
import type { FileSystemService } from '../services/filesystem.js'
import type { SkillService } from '../services/skill.js'
import type { ProjectService } from '../services/project.js'

export function createApiRouter(deps: {
  agentService: AgentService
  fileService: FileSystemService
  skillService: SkillService
  projectService: ProjectService
}): Router {
  const router = Router()
  const { agentService, fileService, skillService, projectService } = deps

  // ============ Project API ============

  /** 获取项目列表 */
  router.get('/projects', (_req, res) => {
    res.json({ projects: projectService.getProjects() })
  })

  /** 添加项目 */
  router.post('/projects', async (req, res) => {
    const { name, path, description } = req.body as { name: string; path: string; description?: string }
    if (!name || !path) {
      res.status(400).json({ error: 'name and path are required' })
      return
    }
    try {
      const project = await projectService.addProject({ name, path, description })
      res.json({ project })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  /** 删除项目 */
  router.delete('/projects/:id', async (req, res) => {
    const success = await projectService.removeProject(req.params.id)
    if (!success) {
      res.status(404).json({ error: 'Project not found' })
      return
    }
    res.json({ success: true })
  })

  /** 扫描项目 Skills */
  router.get('/projects/:id/skills', async (req, res) => {
    try {
      const skills = await projectService.scanProjectSkills(req.params.id)
      res.json({ skills })
    } catch (err) {
      res.status(404).json({ error: (err as Error).message })
    }
  })

  // ============ Agent API ============

  /** 获取可用 Agent 列表 */
  router.get('/agents', (_req, res) => {
    res.json({ agents: agentService.getAgents() })
  })

  /** 执行 Agent 任务 */
  router.post('/agents/execute', async (req, res) => {
    const { agentId, prompt, cwd } = req.body as { agentId: string; prompt: string; cwd?: string }

    if (!agentId || !prompt) {
      res.status(400).json({ error: 'agentId and prompt are required' })
      return
    }

    try {
      const record = await agentService.execute(agentId, prompt, { cwd })
      res.json({ task: record })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  /** 获取任务历史 */
  router.get('/tasks', (_req, res) => {
    const sessions = agentService.getHistory()
    res.json({ tasks: sessions })
  })

  // ============ File API ============

  /** 读取文件 */
  router.get('/files/read', async (req, res) => {
    const { path } = req.query as { path: string }
    if (!path) {
      res.status(400).json({ error: 'path is required' })
      return
    }
    try {
      const content = await fileService.readFile(path)
      res.json({ content, path })
    } catch (err) {
      res.status(404).json({ error: (err as Error).message })
    }
  })

  /** 列出目录 */
  router.get('/files/list', async (req, res) => {
    const { path } = req.query as { path: string }
    if (!path) {
      res.status(400).json({ error: 'path is required' })
      return
    }
    try {
      const entries = await fileService.listDir(path)
      res.json({ entries, path })
    } catch (err) {
      res.status(404).json({ error: (err as Error).message })
    }
  })

  /** 写入文件 */
  router.post('/files/write', async (req, res) => {
    const { path, content } = req.body as { path: string; content: string }
    if (!path || content === undefined) {
      res.status(400).json({ error: 'path and content are required' })
      return
    }
    try {
      await fileService.writeFile(path, content)
      res.json({ success: true, path })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  // ============ Skill API ============

  /** 获取 Skill 列表 */
  router.get('/skills', (_req, res) => {
    res.json({ skills: skillService.getSkills() })
  })

  /** 获取 Skill 详情 */
  router.get('/skills/:name', async (req, res) => {
    const skill = skillService.getSkill(req.params.name)
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' })
      return
    }
    try {
      const content = await skillService.readSkillContent(skill.path)
      res.json({ ...skill, content })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  /** 重新扫描 Skills */
  router.post('/skills/reload', async (req, res) => {
    const { paths } = req.body as { paths?: string[] }
    const searchPaths = paths || [
      `${process.env.HOME}/.catpaw/skills`,
      `${process.cwd()}/.catpaw/skills`,
    ]
    const skills = await skillService.loadSkills(searchPaths)
    res.json({ skills, count: skills.length })
  })

  return router
}
