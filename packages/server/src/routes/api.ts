import { Router } from 'express'
import type { AgentService } from '../services/agent.js'
import type { FileSystemService } from '../services/filesystem.js'
import type { SkillService } from '../services/skill.js'
import type { ProjectService } from '../services/project.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { TemplateService } from '../services/template.js'
import type { AuthService } from '../services/auth.js'

export function createApiRouter(deps: {
  agentService: AgentService
  fileService: FileSystemService
  skillService: SkillService
  projectService: ProjectService
  workflowEngine: WorkflowEngine
  templateService: TemplateService
  authService: AuthService
}): Router {
  const router = Router()
  const { agentService, fileService, skillService, projectService, workflowEngine, templateService, authService } = deps

  // ════════════════════════════════════════
  // Auth API (GitHub OAuth)
  // ════════════════════════════════════════

  /** 获取 GitHub OAuth 授权地址 */
  router.get('/auth/github', (req, res) => {
    const host = req.headers.host || 'localhost:3001'
    const protocol = req.headers['x-forwarded-proto'] || 'http'
    const redirectUri = `${protocol}://${host}/api/auth/callback`
    const url = authService.getAuthUrl(redirectUri)
    res.json({ success: true, data: { url, configured: authService.isConfigured() } })
  })

  /** GitHub OAuth 回调 */
  router.get('/auth/callback', async (req, res) => {
    const { code } = req.query as { code?: string }
    if (!code) {
      res.status(400).json({ success: false, error: 'Missing code parameter' })
      return
    }
    try {
      const accessToken = await authService.exchangeCode(code)
      const user = await authService.login(accessToken)
      // 重定向回前端页面
      const frontendUrl = process.env.FRONTEND_URL || '/agent-flow/'
      res.redirect(`${frontendUrl}#auth=success&user=${encodeURIComponent(user.login)}`)
    } catch (err) {
      const frontendUrl = process.env.FRONTEND_URL || '/agent-flow/'
      res.redirect(`${frontendUrl}#auth=error&message=${encodeURIComponent((err as Error).message)}`)
    }
  })

  /** 获取当前登录用户 */
  router.get('/auth/me', (_req, res) => {
    const user = authService.getCurrentUser()
    res.json({ success: true, data: { user, authenticated: authService.isAuthenticated() } })
  })

  /** 登出 */
  router.post('/auth/logout', async (_req, res) => {
    await authService.logout()
    res.json({ success: true })
  })

  /** 获取 GitHub repos 列表 */
  router.get('/auth/repos', async (_req, res) => {
    try {
      const repos = await authService.fetchRepos()
      res.json({ success: true, data: { repos } })
    } catch (err) {
      res.status(401).json({ success: false, error: (err as Error).message })
    }
  })

  // ════════════════════════════════════════
  // Project API
  // ════════════════════════════════════════

  router.get('/projects', (_req, res) => {
    res.json({ success: true, data: { projects: projectService.getProjects() } })
  })

  router.post('/projects', async (req, res) => {
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

  router.put('/projects/:id', async (req, res) => {
    const { name, description, contextConfig } = req.body
    const project = await projectService.updateProject(req.params.id, { name, description, contextConfig })
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true, data: { project } })
  })

  router.delete('/projects/:id', async (req, res) => {
    const success = await projectService.removeProject(req.params.id)
    if (!success) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    res.json({ success: true })
  })

  router.get('/projects/:id/skills', async (req, res) => {
    try {
      const skills = await projectService.scanProjectSkills(req.params.id)
      res.json({ success: true, data: { skills } })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  // ════════════════════════════════════════
  // Template API (工作流模板)
  // ════════════════════════════════════════

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

  // ════════════════════════════════════════
  // Run API (工作流实例 — 核心状态机)
  // ════════════════════════════════════════

  /** 获取项目的所有 Runs */
  router.get('/runs', (req, res) => {
    const projectId = req.query.projectId as string | undefined
    const runs = workflowEngine.getRuns(projectId)
    res.json({ success: true, data: { runs } })
  })

  /** 获取单个 Run 详情 */
  router.get('/runs/:id', (req, res) => {
    const run = workflowEngine.getRun(req.params.id)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    res.json({ success: true, data: { run } })
  })

  /** 创建 Run（从模板实例化） */
  router.post('/runs', (req, res) => {
    const { projectId, templateId, name } = req.body
    if (!projectId || !templateId) {
      res.status(400).json({ success: false, error: 'projectId and templateId are required' })
      return
    }

    const template = templateService.getTemplate(templateId)
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' })
      return
    }

    const run = workflowEngine.createRun(projectId, template, name)
    res.json({ success: true, data: { run } })
  })

  /** 启动 Run */
  router.post('/runs/:id/start', (req, res) => {
    try {
      const run = workflowEngine.startRun(req.params.id)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 删除 Run */
  router.delete('/runs/:id', (req, res) => {
    const success = workflowEngine.deleteRun(req.params.id)
    if (!success) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    res.json({ success: true })
  })

  // ════════════════════════════════════════
  // Node API (节点状态操作)
  // ════════════════════════════════════════

  /** 启动节点（ready → running） */
  router.post('/runs/:runId/nodes/:nodeId/start', (req, res) => {
    try {
      const node = workflowEngine.startNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 提交节点决策 */
  router.post('/runs/:runId/nodes/:nodeId/submit', (req, res) => {
    const { decision, error } = req.body
    try {
      const node = workflowEngine.submitNodeDecision(req.params.runId, req.params.nodeId, decision, error)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 用户确认节点（wait_user_review → completed） */
  router.post('/runs/:runId/nodes/:nodeId/approve', (req, res) => {
    try {
      const node = workflowEngine.approveNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 用户打回节点（wait_user_review → running） */
  router.post('/runs/:runId/nodes/:nodeId/reject', (req, res) => {
    const { feedback } = req.body
    try {
      const node = workflowEngine.rejectNode(req.params.runId, req.params.nodeId, feedback)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 跳过节点 */
  router.post('/runs/:runId/nodes/:nodeId/skip', (req, res) => {
    try {
      const node = workflowEngine.skipNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 回滚节点 */
  router.post('/runs/:runId/nodes/:nodeId/rollback', (req, res) => {
    try {
      workflowEngine.rollbackNode(req.params.runId, req.params.nodeId)
      const run = workflowEngine.getRun(req.params.runId)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 强制重置节点（running → ready，用于卡住的节点） */
  router.post('/runs/:runId/nodes/:nodeId/force-reset', (req, res) => {
    try {
      const node = workflowEngine.forceResetNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取节点产出物 */
  router.get('/runs/:runId/nodes/:nodeId/artifacts', (req, res) => {
    const artifacts = workflowEngine.getNodeArtifacts(req.params.runId, req.params.nodeId)
    res.json({ success: true, data: { artifacts } })
  })

  /** 添加节点产出物 */
  router.post('/runs/:runId/nodes/:nodeId/artifacts', (req, res) => {
    try {
      const artifact = workflowEngine.addArtifact(req.params.runId, req.params.nodeId, req.body)
      res.json({ success: true, data: { artifact } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  // ════════════════════════════════════════
  // Agent API (Agent 调度与 Turn 管理)
  // ════════════════════════════════════════

  /** 获取可用 Agent 列表 */
  router.get('/agents', (_req, res) => {
    res.json({ success: true, data: { agents: agentService.getAgents() } })
  })

  /** 获取可用 Agent 列表（含 CLI 可用性状态） */
  router.get('/agents/status', (_req, res) => {
    res.json({ success: true, data: { agents: agentService.getAgentsWithStatus() } })
  })

  /** 按角色获取 Agent */
  router.get('/agents/role/:role', (req, res) => {
    const agents = agentService.getAgentsByRole(req.params.role as any)
    res.json({ success: true, data: { agents } })
  })

  /** 获取当前活跃的 Turn 列表 */
  router.get('/agents/active-turns', (_req, res) => {
    res.json({ success: true, data: { activeTurnIds: agentService.getActiveTurnIds() } })
  })

  /** 执行 Agent Turn（核心调度入口 — 异步非阻塞）
   *  立即返回 turnId，后台异步执行。进度通过 WebSocket 推送。
   */
  router.post('/agents/execute-turn', (req, res) => {
    const { agentId, nodeId, runId, prompt, cwd, contextArtifacts } = req.body
    if (!agentId || !nodeId || !runId || !prompt) {
      res.status(400).json({ success: false, error: 'agentId, nodeId, runId, and prompt are required' })
      return
    }
    try {
      // 同步检测 CLI 可用性 — 快速失败
      const agent = agentService.getAgent(agentId)
      if (!agent) {
        res.status(404).json({ success: false, error: `Agent not found: ${agentId}` })
        return
      }

      // 异步启动执行（不 await，立即返回）
      const turnId = agentService.startTurnAsync({ agentId, nodeId, runId, prompt, cwd, contextArtifacts })
      res.json({ success: true, data: { turnId } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 取消 Turn */
  router.post('/agents/cancel-turn', (req, res) => {
    const { turnId } = req.body
    const cancelled = agentService.cancelTurn(turnId)
    res.json({ success: true, data: { cancelled } })
  })

  /** 回答 Agent 提问 */
  router.post('/agents/answer', (req, res) => {
    const { nodeId, runId, agentId, originalQuestion, answer, cwd } = req.body
    try {
      const turnId = agentService.answerQuestion({ nodeId, runId, agentId, originalQuestion, answer, cwd })
      res.json({ success: true, data: { turnId } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取节点的 Turn 历史 */
  router.get('/agents/turns/:nodeId', (req, res) => {
    const turns = workflowEngine.getNodeTurns(req.params.nodeId)
    res.json({ success: true, data: { turns } })
  })

  // ════════════════════════════════════════
  // File API
  // ════════════════════════════════════════

  router.get('/files/read', async (req, res) => {
    const { path } = req.query as { path: string }
    if (!path) {
      res.status(400).json({ success: false, error: 'path is required' })
      return
    }
    try {
      const content = await fileService.readFile(path)
      res.json({ success: true, data: { content, path } })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  router.get('/files/list', async (req, res) => {
    const { path } = req.query as { path: string }
    if (!path) {
      res.status(400).json({ success: false, error: 'path is required' })
      return
    }
    try {
      const entries = await fileService.listDir(path)
      res.json({ success: true, data: { entries, path } })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  router.post('/files/write', async (req, res) => {
    const { path, content } = req.body as { path: string; content: string }
    if (!path || content === undefined) {
      res.status(400).json({ success: false, error: 'path and content are required' })
      return
    }
    try {
      await fileService.writeFile(path, content)
      res.json({ success: true, data: { path } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  // ════════════════════════════════════════
  // Skill API
  // ════════════════════════════════════════

  router.get('/skills', (_req, res) => {
    res.json({ success: true, data: { skills: skillService.getSkills() } })
  })

  router.get('/skills/:name', async (req, res) => {
    const skill = skillService.getSkill(req.params.name)
    if (!skill) {
      res.status(404).json({ success: false, error: 'Skill not found' })
      return
    }
    try {
      const content = await skillService.readSkillContent(skill.path)
      res.json({ success: true, data: { ...skill, content } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  router.post('/skills/reload', async (req, res) => {
    const { paths } = req.body as { paths?: string[] }
    const searchPaths = paths || [
      `${process.env.HOME}/.catpaw/skills`,
      `${process.env.HOME}/.claude/skills`,
      `${process.env.HOME}/.codex/skills`,
      `${process.cwd()}/.catpaw/skills`,
      `${process.cwd()}/.claude/skills`,
      `${process.cwd()}/.codex/skills`,
    ]
    const skills = await skillService.loadSkills(searchPaths)
    res.json({ success: true, data: { skills, count: skills.length } })
  })

  return router
}
