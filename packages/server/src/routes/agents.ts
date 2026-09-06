import { Router, type Response } from 'express'
import { isAbsolute, relative, resolve, sep } from 'path'
import type { AgentService } from '../services/agent.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { DynamicAgentFactory } from '../services/dynamic-agent-factory.js'
import type { ProjectService } from '../services/project.js'

class ExecutionRequestError extends Error {}

export function createAgentsRouter(deps: {
  agentService: AgentService
  workflowEngine: WorkflowEngine
  dynamicAgentFactory: DynamicAgentFactory
  projectService: ProjectService
}): Router {
  const router = Router()
  const { agentService, workflowEngine, dynamicAgentFactory, projectService } = deps

  const resolveExecutionTarget = (
    runId: string,
    nodeId: string,
    requestedCwd?: string,
    useScriptCwd = false
  ) => {
    const run = workflowEngine.getRun(runId)
    if (!run) throw new ExecutionRequestError(`Run not found: ${runId}`)

    const node = run.nodes.find(item => item.id === nodeId)
    if (!node) throw new ExecutionRequestError(`Node not found in run ${runId}: ${nodeId}`)

    const project = projectService.getProject(run.projectId)
    if (!project?.path) throw new ExecutionRequestError(`Project path not found: ${run.projectId}`)

    const projectRoot = resolve(project.path)
    const configuredCwd = resolve(projectRoot, useScriptCwd && node.scriptCwd ? node.scriptCwd : '.')
    const pathFromProject = relative(projectRoot, configuredCwd)
    if (pathFromProject === '..' || pathFromProject.startsWith(`..${sep}`) || isAbsolute(pathFromProject)) {
      throw new ExecutionRequestError('Configured working directory is outside the project')
    }
    if (requestedCwd && resolve(requestedCwd) !== configuredCwd) {
      throw new ExecutionRequestError('Requested working directory does not match the configured project path')
    }

    return { run, node, cwd: configuredCwd }
  }

  const sendExecutionError = (res: Response, err: unknown) => {
    const status = err instanceof ExecutionRequestError ? 400 : 500
    res.status(status).json({ success: false, error: (err as Error).message })
  }

  // ═══════════════ Agent API ═══════════════

  router.get('/models/codex', async (req, res) => {
    const catalog = await agentService.modelCatalog.get(req.query.refresh === 'true')
    res.json({ success: true, data: catalog })
  })

  router.put('/:id/model', (req, res) => {
    try {
      const agent = agentService.setAgentModel(req.params.id, req.body?.model)
      res.json({ success: true, data: { agent } })
    } catch (error) {
      res.status(400).json({ success: false, error: (error as Error).message })
    }
  })

  /** 获取可用 Agent 列表 */
  router.get('/', (_req, res) => {
    res.json({ success: true, data: { agents: agentService.getAgents() } })
  })

  /** 获取可用 Agent 列表（含 CLI 可用性状态） */
  router.get('/status', (_req, res) => {
    res.json({ success: true, data: { agents: agentService.getAgentsWithStatus() } })
  })

  /** 按角色获取 Agent */
  router.get('/role/:role', (req, res) => {
    const agents = agentService.getAgentsByRole(req.params.role as any)
    res.json({ success: true, data: { agents } })
  })

  // ═══════════════ AgentCard API ═══════════════

  /** 获取所有 AgentCard */
  router.get('/cards', (_req, res) => {
    res.json({ success: true, data: { cards: agentService.getCards() } })
  })

  /** 基于能力查询 Agent（必须在 :id 路由之前，避免 Express 路由匹配冲突） */
  router.get('/cards/query/capability/:capabilityId', (req, res) => {
    const minStrength = parseFloat(req.query.minStrength as string) || 0.3
    const cards = agentService.queryByCapability(req.params.capabilityId, minStrength)
    res.json({ success: true, data: { cards } })
  })

  /** 智能路由：找到最适合任务的 Agent */
  router.post('/cards/find-best', (req, res) => {
    const { role, capabilities, language, domain, nodeType } = req.body
    const cards = agentService.findBestForTask({ role, capabilities, language, domain, nodeType })
    res.json({ success: true, data: { cards } })
  })

  /** 获取指定 AgentCard（:id 路由必须在所有具名路径之后） */
  router.get('/cards/:id', (req, res) => {
    const card = agentService.getCard(req.params.id)
    if (!card) {
      res.status(404).json({ success: false, error: `AgentCard not found: ${req.params.id}` })
      return
    }
    res.json({ success: true, data: { card } })
  })

  /** 获取当前活跃的 Turn 列表 */
  router.get('/active-turns', (_req, res) => {
    res.json({ success: true, data: { activeTurnIds: agentService.getActiveTurnIds() } })
  })

  /** 执行 Agent Turn（核心调度入口 — 异步非阻塞）
   *  立即返回 turnId，后台异步执行。进度通过 WebSocket 推送。
   */
  router.post('/execute-turn', (req, res) => {
    const { agentId, nodeId, runId, prompt, cwd, contextArtifacts } = req.body
    if (!agentId || !nodeId || !runId || !prompt) {
      res.status(400).json({ success: false, error: 'agentId, nodeId, runId, and prompt are required' })
      return
    }
    try {
      const target = resolveExecutionTarget(runId, nodeId, cwd)
      // 同步检测 CLI 可用性 — 快速失败
      const agent = agentService.getAgent(agentId)
      if (!agent) {
        res.status(404).json({ success: false, error: `Agent not found: ${agentId}` })
        return
      }

      // 异步启动执行（不 await，立即返回）
      const turnId = agentService.startTurnAsync({ agentId, nodeId, runId, prompt, cwd: target.cwd, contextArtifacts })
      res.json({ success: true, data: { turnId } })
    } catch (err) {
      sendExecutionError(res, err)
    }
  })

  router.post('/resume-turn', async (req, res) => {
    const { runId, nodeId, turnId, prompt } = req.body || {}
    if (![runId, nodeId, turnId, prompt].every(value => typeof value === 'string' && value.trim())) {
      res.status(400).json({ success: false, error: 'runId, nodeId, turnId and prompt are required' })
      return
    }
    try {
      resolveExecutionTarget(runId, nodeId)
      const resumedTurnId = await agentService.resumeProviderTurn({ runId, nodeId, turnId, prompt })
      res.json({ success: true, data: { turnId: resumedTurnId } })
    } catch (error) {
      res.status(409).json({ success: false, error: (error as Error).message })
    }
  })

  router.get('/events/:runId/:nodeId/:turnId', (req, res) => {
    try {
      const { runId, nodeId, turnId } = req.params
      const page = agentService.getProviderEvents(runId, nodeId, turnId, Number(req.query.after || 0))
      res.json({ success: true, data: page })
    } catch (error) {
      res.status(400).json({ success: false, error: (error as Error).message })
    }
  })

  /** 执行 DET/HYB 模式（确定性脚本执行） */
  router.post('/execute-det', async (req, res) => {
    const { nodeId, runId, script, cwd, executionMode, agentId, prompt } = req.body
    if (!nodeId || !runId || !script) {
      res.status(400).json({ success: false, error: 'nodeId, runId, and script are required' })
      return
    }
    try {
      const target = resolveExecutionTarget(runId, nodeId, cwd, true)
      if (target.node.status !== 'running') {
        throw new ExecutionRequestError(`Node ${nodeId} is not running`)
      }
      if (target.node.executionMode !== 'det' && target.node.executionMode !== 'hyb') {
        throw new ExecutionRequestError(`Node ${nodeId} is not configured for DET/HYB execution`)
      }
      if (!target.node.script || script !== target.node.script) {
        throw new ExecutionRequestError('Requested script does not match the node configuration')
      }
      if (executionMode && executionMode !== target.node.executionMode) {
        throw new ExecutionRequestError('Requested execution mode does not match the node configuration')
      }

      let turnId: string
      if (target.node.executionMode === 'hyb') {
        if (!agentId || !prompt) throw new ExecutionRequestError('agentId and prompt are required for HYB execution')
        turnId = agentService.executeHYB({ nodeId, runId, script: target.node.script, agentId, prompt, cwd: target.cwd })
      } else {
        turnId = agentService.executeDET({ nodeId, runId, script: target.node.script, cwd: target.cwd })
      }
      res.json({ success: true, data: { turnId } })
    } catch (err) {
      sendExecutionError(res, err)
    }
  })

  /** 取消 Turn */
  router.post('/cancel-turn', (req, res) => {
    const { turnId } = req.body
    const cancelled = agentService.cancelTurn(turnId)
    res.json({ success: true, data: { cancelled } })
  })

  /** 回答 Agent 提问 */
  router.post('/answer', (req, res) => {
    const { nodeId, runId, agentId, originalQuestion, answer, cwd } = req.body
    try {
      const target = resolveExecutionTarget(runId, nodeId, cwd)
      const turnId = agentService.answerQuestion({ nodeId, runId, agentId, originalQuestion, answer, cwd: target.cwd })
      res.json({ success: true, data: { turnId } })
    } catch (err) {
      sendExecutionError(res, err)
    }
  })

  /** 获取节点的 Turn 历史 */
  router.get('/turns/:nodeId', (req, res) => {
    const turns = workflowEngine.getNodeTurns(req.params.nodeId)
    res.json({ success: true, data: { turns } })
  })

  /** 并行自动执行：获取所有 ready 节点并批量启动 Agent */
  router.post('/auto-execute/:runId', async (req, res) => {
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
        const target = resolveExecutionTarget(runId, node.id, cwd)
        const prompt = node.prompt || node.description
        const turnId = agentService.startTurnAsync({
          agentId: defaultAgent,
          nodeId: node.id,
          runId,
          prompt,
          cwd: target.cwd,
        })
        startedTurns.push({ nodeId: node.id, turnId })
      }

      res.json({ success: true, data: { startedTurns, totalReady: readyNodes.length } })
    } catch (err) {
      sendExecutionError(res, err)
    }
  })

  // ═══════════════ Dynamic Agent Instance API ═══════════════

  /** 为节点创建动态 Agent 实例 */
  router.post('/instances/create', async (req, res) => {
    const { nodeId, runId, preferredAgentId } = req.body
    if (!nodeId || !runId) {
      res.status(400).json({ success: false, error: 'nodeId and runId are required' })
      return
    }
    try {
      const run = workflowEngine.getRun(runId)
      if (!run) {
        res.status(404).json({ success: false, error: `Run not found: ${runId}` })
        return
      }
      const node = run.nodes.find(n => n.id === nodeId)
      if (!node) {
        res.status(404).json({ success: false, error: `Node not found: ${nodeId}` })
        return
      }
      const instance = await dynamicAgentFactory.createInstance(node, run, preferredAgentId)
      res.json({ success: true, data: { instance } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取 Run 下所有动态 Agent 实例 */
  router.get('/instances/:runId', (req, res) => {
    const instances = dynamicAgentFactory.getAllInstances(req.params.runId)
    res.json({ success: true, data: { instances } })
  })

  /** 获取节点关联的动态实例 */
  router.get('/instances/:runId/:nodeId', (req, res) => {
    const instance = dynamicAgentFactory.getInstanceByNode(req.params.nodeId, req.params.runId)
    res.json({ success: true, data: { instance: instance || null } })
  })

  /** 使用动态实例执行 Agent Turn（增强版 execute-turn）*/
  router.post('/execute-dynamic', async (req, res) => {
    const { nodeId, runId, userInput, preferredAgentId, cwd } = req.body
    if (!nodeId || !runId || !userInput) {
      res.status(400).json({ success: false, error: 'nodeId, runId, and userInput are required' })
      return
    }
    try {
      const run = workflowEngine.getRun(runId)
      if (!run) {
        res.status(404).json({ success: false, error: `Run not found: ${runId}` })
        return
      }
      const node = run.nodes.find(n => n.id === nodeId)
      if (!node) {
        res.status(404).json({ success: false, error: `Node not found: ${nodeId}` })
        return
      }
      const target = resolveExecutionTarget(runId, nodeId, cwd)

      // 1. 创建动态实例（内部已 await Context DB 四层装配）
      const instance = await dynamicAgentFactory.createInstance(node, run, preferredAgentId)

      // 2. 构建完整 prompt（含 scoped context + context DB 层级）
      const fullPrompt = dynamicAgentFactory.buildFullPrompt(instance, userInput)

      // 3. 激活实例
      dynamicAgentFactory.activateInstance(instance.id)

      // 4. 启动 Agent Turn
      const turnId = agentService.startTurnAsync({
        agentId: instance.baseAgentId,
        nodeId,
        runId,
        prompt: fullPrompt,
        cwd: target.cwd,
      })

      res.json({
        success: true,
        data: { turnId, instanceId: instance.id, instanceName: instance.name },
      })
    } catch (err) {
      sendExecutionError(res, err)
    }
  })

  return router
}
