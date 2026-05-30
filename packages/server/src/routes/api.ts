import { Router } from 'express'
import type { AgentService } from '../services/agent.js'
import type { FileSystemService } from '../services/filesystem.js'
import type { SkillService } from '../services/skill.js'
import type { ProjectService } from '../services/project.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { TemplateService } from '../services/template.js'
import type { AuthService } from '../services/auth.js'
import type { GitService } from '../services/git.js'
import type { RepoIsolationService } from '../services/repo-isolation.js'
import type { SkillMaterializationService } from '../services/skill-materialization.js'
import type { PermissionIsolationService } from '../services/permission-isolation.js'
import type { A2AProtocolService } from '../services/a2a-protocol.js'
import type { ContractValidatorService } from '../services/contract-validator.js'
import type { RobustnessService } from '../services/robustness.js'

export function createApiRouter(deps: {
  agentService: AgentService
  fileService: FileSystemService
  skillService: SkillService
  projectService: ProjectService
  workflowEngine: WorkflowEngine
  templateService: TemplateService
  authService: AuthService
  gitService: GitService
  repoIsolationService: RepoIsolationService
  skillMaterializationService: SkillMaterializationService
  permissionIsolationService: PermissionIsolationService
  a2aProtocolService: A2AProtocolService
  contractValidatorService: ContractValidatorService
  robustnessService: RobustnessService
}): Router {
  const router = Router()
  const {
    agentService, fileService, skillService, projectService,
    workflowEngine, templateService, authService, gitService,
    repoIsolationService, skillMaterializationService,
    permissionIsolationService, a2aProtocolService,
    contractValidatorService, robustnessService,
  } = deps

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
    const { code, state } = req.query as { code?: string; state?: string }
    if (!code) {
      res.status(400).json({ success: false, error: 'Missing code parameter' })
      return
    }
    // 校验 state 参数防止 CSRF 攻击
    if (!state || !authService.validateState(state)) {
      res.status(403).json({ success: false, error: 'Invalid or expired OAuth state parameter' })
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
  router.post('/runs', async (req, res) => {
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

    const run = await workflowEngine.createRun(projectId, template, name)
    res.json({ success: true, data: { run } })
  })

  /** 启动 Run */
  router.post('/runs/:id/start', async (req, res) => {
    try {
      const run = await workflowEngine.startRun(req.params.id)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 删除 Run */
  router.delete('/runs/:id', async (req, res) => {
    const success = await workflowEngine.deleteRun(req.params.id)
    if (!success) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    res.json({ success: true })
  })

  /** 获取 Run 的 Token 消耗统计 */
  router.get('/runs/:id/token-stats', (req, res) => {
    try {
      const stats = workflowEngine.getRunTokenStats(req.params.id)
      res.json({ success: true, data: stats })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  // ════════════════════════════════════════
  // Node API (节点状态操作)
  // ════════════════════════════════════════

  /** 启动节点（ready → running） */
  router.post('/runs/:runId/nodes/:nodeId/start', async (req, res) => {
    try {
      const node = await workflowEngine.startNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 提交节点决策 */
  router.post('/runs/:runId/nodes/:nodeId/submit', async (req, res) => {
    const { decision, error } = req.body
    try {
      const node = await workflowEngine.submitNodeDecision(req.params.runId, req.params.nodeId, decision, error)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 用户确认节点（wait_user_review → completed） */
  router.post('/runs/:runId/nodes/:nodeId/approve', async (req, res) => {
    try {
      const node = await workflowEngine.approveNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 用户打回节点（wait_user_review → running） */
  router.post('/runs/:runId/nodes/:nodeId/reject', async (req, res) => {
    const { feedback } = req.body
    try {
      const node = await workflowEngine.rejectNode(req.params.runId, req.params.nodeId, feedback)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 跳过节点 */
  router.post('/runs/:runId/nodes/:nodeId/skip', async (req, res) => {
    try {
      const node = await workflowEngine.skipNode(req.params.runId, req.params.nodeId)
      res.json({ success: true, data: { node } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 回滚节点 */
  router.post('/runs/:runId/nodes/:nodeId/rollback', async (req, res) => {
    try {
      await workflowEngine.rollbackNode(req.params.runId, req.params.nodeId)
      const run = workflowEngine.getRun(req.params.runId)
      res.json({ success: true, data: { run } })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
  })

  /** 强制重置节点（running → ready，用于卡住的节点） */
  router.post('/runs/:runId/nodes/:nodeId/force-reset', async (req, res) => {
    try {
      const node = await workflowEngine.forceResetNode(req.params.runId, req.params.nodeId)
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
  router.post('/runs/:runId/nodes/:nodeId/artifacts', async (req, res) => {
    try {
      const artifact = await workflowEngine.addArtifact(req.params.runId, req.params.nodeId, req.body)
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

  /** 并行自动执行：获取所有 ready 节点并批量启动 Agent */
  router.post('/runs/:runId/auto-execute', async (req, res) => {
    const { agentId, cwd } = req.body
    const runId = req.params.runId
    try {
      const readyNodes = workflowEngine.getReadyNodes(runId)
      if (readyNodes.length === 0) {
        res.json({ success: true, data: { startedTurns: [], message: 'No ready nodes to execute' } })
        return
      }

      const config = workflowEngine.getRunConfig(runId)
      const maxParallel = config?.maxParallel || 5
      const defaultAgent = agentId || config?.defaultAgentId
      if (!defaultAgent) {
        res.status(400).json({ success: false, error: 'agentId is required (or set defaultAgentId in run config)' })
        return
      }

      const nodesToExecute = readyNodes.slice(0, maxParallel)
      const startedTurns: Array<{ nodeId: string; turnId: string }> = []

      for (const node of nodesToExecute) {
        // 先将节点状态从 ready → running，然后再启动 Agent
        await workflowEngine.startNode(runId, node.id)
        const prompt = node.prompt || node.description
        const turnId = agentService.startTurnAsync({
          agentId: defaultAgent,
          nodeId: node.id,
          runId,
          prompt,
          cwd,
        })
        startedTurns.push({ nodeId: node.id, turnId })
      }

      res.json({ success: true, data: { startedTurns, totalReady: readyNodes.length } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 更新 Run 配置（自动执行、并行度等） */
  router.patch('/runs/:runId/config', async (req, res) => {
    try {
      await workflowEngine.updateRunConfig(req.params.runId, req.body)
      res.json({ success: true })
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message })
    }
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

  // ════════════════════════════════════════
  // Git API（Git 集成与 Diff Review）
  // ════════════════════════════════════════

  /** 获取 Git 仓库状态 */
  router.get('/git/status', (req, res) => {
    const { cwd } = req.query as { cwd?: string }
    const workDir = cwd || process.cwd()
    if (!gitService.isGitRepo(workDir)) {
      res.status(400).json({ success: false, error: 'Not a git repository' })
      return
    }
    const status = gitService.getStatus(workDir)
    res.json({ success: true, data: status })
  })

  /** 获取最近 commits */
  router.get('/git/commits', (req, res) => {
    const { cwd, count } = req.query as { cwd?: string; count?: string }
    const workDir = cwd || process.cwd()
    const commits = gitService.getRecentCommits(workDir, count ? parseInt(count, 10) : 10)
    res.json({ success: true, data: { commits } })
  })

  /** 获取工作区 diff */
  router.get('/git/diff', (req, res) => {
    const { cwd, from, to, staged } = req.query as { cwd?: string; from?: string; to?: string; staged?: string }
    const workDir = cwd || process.cwd()
    
    let diff: string
    if (from) {
      diff = gitService.getDiffBetween(workDir, from, to)
    } else if (staged === 'true') {
      diff = gitService.getStagedDiff(workDir)
    } else {
      diff = gitService.getWorkingDiff(workDir)
    }
    
    const summary = gitService.generateDiffSummary(diff)
    res.json({ success: true, data: { diff, summary } })
  })

  /** 获取变更文件列表 */
  router.get('/git/changed-files', (req, res) => {
    const { cwd, from, to } = req.query as { cwd?: string; from?: string; to?: string }
    const workDir = cwd || process.cwd()
    const files = gitService.getChangedFiles(workDir, from, to)
    res.json({ success: true, data: { files } })
  })

  // ════════════════════════════════════════
  // Repo Isolation API (仓库隔离)
  // ════════════════════════════════════════

  /** 获取 Run 的仓库池 */
  router.get('/runs/:runId/repo-pool', (req, res) => {
    const pool = repoIsolationService.getPool(req.params.runId)
    res.json({ success: true, data: { pool } })
  })

  /** 向仓库池添加仓库 */
  router.post('/runs/:runId/repo-pool', async (req, res) => {
    const { name, url, branch } = req.body
    if (!name || !url) {
      res.status(400).json({ success: false, error: 'name and url are required' })
      return
    }
    try {
      const repo = await repoIsolationService.addRepo(req.params.runId, { name, url, branch })
      res.json({ success: true, data: { repo } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取活跃工作空间列表 */
  router.get('/workspaces', (_req, res) => {
    const workspaces = repoIsolationService.getActiveWorkspaces()
    res.json({ success: true, data: { workspaces } })
  })

  /** 清理 Run 的仓库和工作空间 */
  router.delete('/runs/:runId/repo-pool', async (req, res) => {
    await repoIsolationService.cleanupRun(req.params.runId)
    res.json({ success: true })
  })

  // ════════════════════════════════════════
  // A2A Protocol API (Agent 间通信)
  // ════════════════════════════════════════

  /** 发送 A2A 消息 */
  router.post('/a2a/send', (req, res) => {
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
  router.post('/a2a/delegate', (req, res) => {
    const { fromAgentId, toAgentId, runId, nodeId, task, priority } = req.body
    try {
      const message = a2aProtocolService.delegateTask({ fromAgentId, toAgentId, runId, nodeId, task, priority })
      res.json({ success: true, data: { message } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取 Agent 收件箱 */
  router.get('/a2a/inbox/:agentId', (req, res) => {
    const { status, type, runId } = req.query as Record<string, string>
    const messages = a2aProtocolService.getInbox(req.params.agentId, {
      status: status as any, type: type as any, runId,
    })
    res.json({ success: true, data: { messages } })
  })

  /** 拉取下一条待处理消息 */
  router.post('/a2a/pull/:agentId', (req, res) => {
    const message = a2aProtocolService.pullNext(req.params.agentId)
    res.json({ success: true, data: { message } })
  })

  /** 确认消息 */
  router.post('/a2a/ack/:messageId', (req, res) => {
    const ok = a2aProtocolService.acknowledge(req.params.messageId)
    res.json({ success: ok })
  })

  /** 解决消息 */
  router.post('/a2a/resolve/:messageId', (req, res) => {
    const ok = a2aProtocolService.resolve(req.params.messageId, req.body.result)
    res.json({ success: ok })
  })

  /** 获取 A2A 统计 */
  router.get('/a2a/stats', (req, res) => {
    const runId = req.query.runId as string | undefined
    const stats = a2aProtocolService.getStats(runId)
    res.json({ success: true, data: stats })
  })

  /** 创建通信通道 */
  router.post('/a2a/channels', (req, res) => {
    const { runId, participants } = req.body
    const channel = a2aProtocolService.createChannel(runId, participants)
    res.json({ success: true, data: { channel } })
  })

  /** 获取 Run 的所有消息 */
  router.get('/a2a/messages/:runId', (req, res) => {
    const messages = a2aProtocolService.getRunMessages(req.params.runId)
    res.json({ success: true, data: { messages } })
  })

  // ════════════════════════════════════════
  // Permission 权限管理 API
  // ════════════════════════════════════════

  /** 设置 Agent 权限策略 */
  router.post('/permissions/policy', (req, res) => {
    const { agentId, runId, repoAccess, filePatterns } = req.body
    if (!agentId || !runId) {
      res.status(400).json({ success: false, error: 'agentId and runId are required' })
      return
    }
    permissionIsolationService.setPolicy({ agentId, runId, repoAccess: repoAccess || [], filePatterns })
    res.json({ success: true })
  })

  /** 获取 Agent 权限策略 */
  router.get('/permissions/policy/:agentId/:runId', (req, res) => {
    const policy = permissionIsolationService.getPolicy(req.params.agentId, req.params.runId)
    res.json({ success: true, data: { policy } })
  })

  /** 权限检查 */
  router.post('/permissions/check', (req, res) => {
    const result = permissionIsolationService.checkAccess(req.body)
    res.json({ success: true, data: result })
  })

  /** 获取审计日志 */
  router.get('/permissions/audit-log', (req, res) => {
    const { runId, agentId, level, limit } = req.query as Record<string, string>
    const log = permissionIsolationService.getAuditLog({
      runId, agentId,
      level: level as 'info' | 'warn' | 'error',
      limit: limit ? parseInt(limit, 10) : undefined,
    })
    res.json({ success: true, data: { log } })
  })

  // ════════════════════════════════════════
  // Contract Validation API (产出物合同验证)
  // ════════════════════════════════════════

  /** 验证节点产出物是否满足合同 */
  router.post('/runs/:runId/nodes/:nodeId/validate-contracts', (req, res) => {
    const run = workflowEngine.getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    const node = run.nodes.find(n => n.id === req.params.nodeId)
    if (!node) {
      res.status(404).json({ success: false, error: 'Node not found' })
      return
    }

    // 从模板获取 OutputContracts
    const template = templateService.getTemplate(run.templateId)
    const templateNode = template?.nodes.find(tn => req.params.nodeId.endsWith(tn.id))
    const contracts = templateNode?.outputContracts || []

    const result = contractValidatorService.validate(node.id, contracts, node.artifacts)
    const report = contractValidatorService.formatReport(result)

    res.json({ success: true, data: { result, report } })
  })

  // ════════════════════════════════════════
  // Robustness API (健壮性)
  // ════════════════════════════════════════

  /** 获取系统健康状态 */
  router.get('/robustness/health', (_req, res) => {
    const health = robustnessService.getHealthStatus()
    res.json({ success: true, data: health })
  })

  /** 获取死信队列 */
  router.get('/robustness/dead-letter', (req, res) => {
    const runId = req.query.runId as string | undefined
    const queue = robustnessService.getDeadLetterQueue(runId)
    res.json({ success: true, data: { queue } })
  })

  /** 解决死信项 */
  router.post('/robustness/dead-letter/:itemId/resolve', (req, res) => {
    const { resolution } = req.body
    const ok = robustnessService.resolveDeadLetter(req.params.itemId, resolution)
    res.json({ success: ok })
  })

  /** 获取 Checkpoint 列表 */
  router.get('/robustness/checkpoints/:runId', (req, res) => {
    const checkpoints = robustnessService.getCheckpoints(req.params.runId)
    res.json({ success: true, data: { checkpoints } })
  })

  /** 创建 Checkpoint */
  router.post('/robustness/checkpoints/:runId', (req, res) => {
    const run = workflowEngine.getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }
    const checkpoint = robustnessService.createCheckpoint(run, req.body.description)
    res.json({ success: true, data: { checkpoint } })
  })

  /** 查询审计日志 */
  router.get('/robustness/audit-log', (req, res) => {
    const { runId, nodeId, action, level, limit } = req.query as Record<string, string>
    const log = robustnessService.queryAuditLog({
      runId, nodeId, action,
      level: level as 'info' | 'warn' | 'error',
      limit: limit ? parseInt(limit, 10) : undefined,
    })
    res.json({ success: true, data: { log } })
  })

  // ════════════════════════════════════════
  // Skill 智能推荐 API
  // ════════════════════════════════════════

  /** 根据节点描述智能推荐 Skills */
  router.post('/skills/recommend', (req, res) => {
    const { description, nodeType } = req.body as { description: string; nodeType?: string }
    if (!description) {
      res.status(400).json({ success: false, error: 'description is required' })
      return
    }
    const allSkills = skillService.getSkills()
    // 简单关键词匹配推荐（后续可接入 embedding 相似度）
    const recommendations = allSkills
      .map(skill => {
        let score = 0
        const descLower = description.toLowerCase()
        const skillDesc = (skill.description + ' ' + skill.triggers.join(' ')).toLowerCase()
        
        // 关键词匹配评分
        for (const trigger of skill.triggers) {
          if (descLower.includes(trigger.toLowerCase())) score += 10
        }
        // 描述相似度（简单词汇重叠）
        const descWords = descLower.split(/\s+/)
        for (const word of descWords) {
          if (word.length > 2 && skillDesc.includes(word)) score += 1
        }
        // 节点类型加权
        if (nodeType && skill.triggers.some(t => t.includes(nodeType))) score += 5
        
        return { skill, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(r => ({ ...r.skill, relevanceScore: r.score }))

    res.json({ success: true, data: { recommendations } })
  })

  // ════════════════════════════════════════
  // Skill Materialization API (Skill 物化)
  // ════════════════════════════════════════

  /** 获取节点的物化 Skill（运行时注入到 Agent 的 Skill 内容） */
  router.get('/skills/materialize/:nodeId', async (req, res) => {
    try {
      const skills = await skillMaterializationService.materializeForNode(req.params.nodeId)
      const prompt = skillMaterializationService.formatSkillsAsPrompt(skills)
      res.json({ success: true, data: { skills, prompt } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 设置节点的 Skill 白名单 */
  router.post('/skills/whitelist/:nodeId', (req, res) => {
    const { allowedSkillIds, denySkillIds } = req.body
    skillMaterializationService.setWhitelist(req.params.nodeId, allowedSkillIds || [], denySkillIds)
    res.json({ success: true })
  })

  /** 获取节点的 Skill 白名单 */
  router.get('/skills/whitelist/:nodeId', (req, res) => {
    const whitelist = skillMaterializationService.getWhitelist(req.params.nodeId)
    res.json({ success: true, data: { whitelist } })
  })

  /** 获取物化统计 */
  router.get('/skills/materialization-stats', (_req, res) => {
    const stats = skillMaterializationService.getStats()
    res.json({ success: true, data: stats })
  })

  return router
}
