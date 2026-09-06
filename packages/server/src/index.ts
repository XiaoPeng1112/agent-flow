import { homedir } from 'os'
import { join as joinModelPath } from 'path'
import { RealtimeReplay } from './services/realtime-replay.js'
import express from 'express'
import cors from 'cors'
import { WebSocketServer, type WebSocket } from 'ws'
import { createServer, type IncomingMessage } from 'http'
import { createApiRouter } from './routes/api.js'
import { TerminalService } from './services/terminal.js'
import { AgentService } from './services/agent.js'
import { FileSystemService } from './services/filesystem.js'
import { SkillService } from './services/skill.js'
import { ProjectService } from './services/project.js'
import { WorkflowEngine } from './services/workflow-engine.js'
import { TemplateService } from './services/template.js'
import { AuthService } from './services/auth.js'
import { GitService } from './services/git.js'
import { RepoIsolationService } from './services/repo-isolation.js'
import { SkillMaterializationService } from './services/skill-materialization.js'
import { PermissionIsolationService } from './services/permission-isolation.js'
import { A2AProtocolService } from './services/a2a-protocol.js'
import { ContractValidatorService } from './services/contract-validator.js'
import { RobustnessService } from './services/robustness.js'
import { DynamicAgentFactory } from './services/dynamic-agent-factory.js'
import { ContextDBService } from './services/context-db.js'
import { ArtifactMergeService } from './services/artifact-merge.js'
import { MetricsCollector } from './services/metrics-collector.js'
import { FeedbackCollector } from './services/feedback-collector.js'
import { WeeklyDigest } from './services/weekly-digest.js'
import { SyncService } from './services/sync.js'
import { SkillExtractionService } from './services/skill-extraction.js'
import { ReadyDispatcher } from './services/ready-dispatcher.js'
import { AutoFlowEngine } from './services/auto-flow-engine.js'
import { ValidationTurnService } from './services/validation-turn.js'
import { L1RuleLifecycleService } from './services/l1-rule-lifecycle.js'
import { AdversarialTurnService } from './services/adversarial-turn.js'
import {
  createRequestSecurityConfig,
  getHeaderToken,
  isOriginAllowed,
  isTokenAllowed,
} from './services/request-security.js'
import type { WsMessage } from './types/index.js'

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || 'localhost'
const requestSecurity = createRequestSecurityConfig()

// ═══════════════ 初始化服务 ═══════════════

const fileService = new FileSystemService()
// 配置文件系统安全：仅允许访问项目工作目录（默认为 cwd）
const allowedFileRoots = (process.env.ALLOWED_FILE_ROOTS || process.cwd()).split(',').map(p => p.trim())
fileService.setAllowedRoots(allowedFileRoots)
const terminalService = new TerminalService()

const skillService = new SkillService()
const projectService = new ProjectService(skillService)
const workflowEngine = new WorkflowEngine()
const templateService = new TemplateService()
const agentService = new AgentService(workflowEngine, joinModelPath(homedir(), '.agent-flow', 'agent-models.json'))
const authService = new AuthService()
const gitService = new GitService()

// === 新增能力服务 ===
const repoIsolationService = new RepoIsolationService()
agentService.injectWorkspaces(repoIsolationService, projectService)
const skillMaterializationService = new SkillMaterializationService(skillService)
const permissionIsolationService = new PermissionIsolationService()
const a2aProtocolService = new A2AProtocolService(workflowEngine)
const contractValidatorService = new ContractValidatorService()
const robustnessService = new RobustnessService()
const contextDBService = new ContextDBService()
const artifactMergeService = new ArtifactMergeService(repoIsolationService, gitService)
const metricsCollector = new MetricsCollector()
const feedbackCollector = new FeedbackCollector()
const weeklyDigest = new WeeklyDigest(feedbackCollector, metricsCollector)
const dynamicAgentFactory = new DynamicAgentFactory(agentService, workflowEngine, projectService, contextDBService, skillMaterializationService)
const syncService = new SyncService(authService, projectService, workflowEngine, templateService)
const skillExtractionService = new SkillExtractionService(skillService, projectService)
const autoFlowEngine = new AutoFlowEngine()
const validationTurnService = new ValidationTurnService()
const l1RuleLifecycleService = new L1RuleLifecycleService()
const adversarialTurnService = new AdversarialTurnService()

// 注入 ContextDBService 到需要它的服务（延迟注入避免循环依赖）
projectService.injectContextDB(contextDBService)
workflowEngine.injectContextDB(contextDBService)
// 注入 AuthService 到 ArtifactMergeService（PR 模式需要 GitHub token）
artifactMergeService.injectAuth(authService)
// 注入 ValidationTurnService 依赖
validationTurnService.inject({
  projectService,
  workflowEngine,
  contractValidator: contractValidatorService,
  feedbackCollector,
  robustnessService,
  repoIsolation: repoIsolationService,
  agentService,
  dynamicAgentFactory,
})
workflowEngine.setExitVerifier((run, node, condition) =>
  validationTurnService.hasPassingCheck(run.id, node.id, condition))
workflowEngine.setCompletionVerifier((run, node) => {
  const verification = validationTurnService.getValidationResult(run.id, node.id)
  return verification?.passed
    ? { passed: true }
    : { passed: false, failedReason: verification?.summary || '缺少当前代码版本的通过验证，请运行验证' }
})
artifactMergeService.setDeliveryVerifier((turnId, runId, nodeId) => {
  const node = workflowEngine.getRun(runId)?.nodes.find(n => n.id === nodeId)
  return node?.status === 'completed' && workflowEngine.getNodeTurns(nodeId).at(-1)?.id === turnId &&
    validationTurnService.getValidationResult(runId, nodeId)?.passed === true
})
// 注入 L1RuleLifecycleService 依赖
l1RuleLifecycleService.inject({
  contextDB: contextDBService,
  feedbackCollector,
})
// 注入 AdversarialTurnService 依赖
adversarialTurnService.inject({
  workflowEngine,
  dynamicAgentFactory,
  agentService,
  a2aProtocol: a2aProtocolService,
  robustnessService,
})
// 注入 AutoFlowEngine 依赖（含 ValidationTurnService + L1RuleLifecycle + Adversarial）
autoFlowEngine.inject({
  workflowEngine,
  contractValidator: contractValidatorService,
  metricsCollector,
  feedbackCollector,
  robustnessService,
  repoIsolation: repoIsolationService,
  validationTurnService,
  l1RuleLifecycle: l1RuleLifecycleService,
  adversarialTurnService,
  emitter: (type, payload) => workflowEngine.emit(type, payload),
})
agentService.injectAutoFlow(autoFlowEngine)
// 注入 AdversarialTurnService 到 AgentService（close handler 自动触发对抗）
agentService.injectAdversarial(adversarialTurnService)
// 注入 A2AProtocolService 到 AgentService（进度汇报 + 任务交付消息）
agentService.injectA2A(a2aProtocolService)
// 注入 FeedbackCollector 到 DynamicAgentFactory（Phase 4: 反馈→上下文注入）
dynamicAgentFactory.injectFeedbackCollector(feedbackCollector)
// 注入 AutoFlowEngine 到 WeeklyDigest（Phase 4: 周报指标）
weeklyDigest.injectAutoFlow(autoFlowEngine)

// ═══════════════ Express 应用 ═══════════════

const app = express()
app.use(cors({
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin, requestSecurity))
  },
}))
app.use((req, res, next) => {
  const origin = req.get('origin')
  if (!isOriginAllowed(origin, requestSecurity)) {
    res.status(403).json({ success: false, error: 'Origin is not allowed' })
    return
  }

  const isPublicCallback = req.method === 'GET' && req.path === '/api/auth/callback'
  const isHealthCheck = req.method === 'GET' && req.path === '/health'
  if (!isPublicCallback && !isHealthCheck && !isTokenAllowed(getHeaderToken(req.headers), requestSecurity)) {
    res.status(401).json({ success: false, error: 'Invalid or missing AgentFlow API token' })
    return
  }
  next()
})

app.use(express.json({ limit: '10mb' }))

// API 路由
app.use('/api', createApiRouter({
  agentService,
  fileService,
  skillService,
  projectService,
  workflowEngine,
  templateService,
  authService,
  gitService,
  repoIsolationService,
  skillMaterializationService,
  permissionIsolationService,
  a2aProtocolService,
  contractValidatorService,
  robustnessService,
  dynamicAgentFactory,
  contextDBService,
  artifactMergeService,
  metricsCollector,
  feedbackCollector,
  weeklyDigest,
  syncService,
  skillExtractionService,
  autoFlowEngine,
  l1RuleLifecycleService,
  validationTurnService,
  adversarialTurnService,
}))

// 健康检查
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.9.1',
    timestamp: Date.now(),
    services: {
      projects: projectService.getProjects().length,
      templates: templateService.getTemplates().length,
      runs: workflowEngine.getRuns().length,
      agents: agentService.getAgents().length,
    },
    capabilities: {
      repoIsolation: true,
      skillMaterialization: true,
      permissionIsolation: true,
      a2aProtocol: true,
      contractValidation: true,
      robustness: robustnessService.getHealthStatus(),
    },
  })
})

// 全局错误处理中间件（必须在所有路由之后注册，捕获未处理的异常统一返回 JSON）
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]', err.message, err.stack?.split('\n').slice(0, 3).join('\n'))
  const statusCode = (err as any).statusCode || 500
  res.status(statusCode).json({ success: false, error: err.message || 'Internal Server Error' })
})

// ═══════════════ HTTP + WebSocket 服务 ═══════════════

const server = createServer(app)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient({ origin, req }: { origin: string; req: IncomingMessage }) {
    const token = new URL(req.url || '/ws', 'http://localhost').searchParams.get('token') || undefined
    return isOriginAllowed(origin, requestSecurity) && isTokenAllowed(token, requestSecurity)
  },
})

// 存储所有连接的客户端
const connectedClients = new Set<WebSocket>()
const synchronizedClients = new Set<WebSocket>()
const realtimeReplay = new RealtimeReplay(() => ({
  runs: workflowEngine.getRuns(),
  activeTurns: [...workflowEngine.getAllTurns().values()].flat().filter(turn => turn.status === 'running' || turn.status === 'paused'),
}))

// 广播消息给所有客户端
function broadcast(message: WsMessage): void {
  const raw = realtimeReplay.publish(message)
  for (const client of synchronizedClients) {
    if (client.readyState === client.OPEN) {
      if (client.bufferedAmount > 8 * 1024 * 1024) client.close(1013, 'Reconnect to synchronize state')
      else client.send(raw)
    }
  }
}

// ═══════════════ Phase 2: AutoFlow 自动启动 Ready 节点 ═══════════════
// 当节点变为 ready 且 autoFlow.autoStart 开启时，自动选择 Agent 并启动执行
const readyDispatcher = new ReadyDispatcher({
  getRun: id => workflowEngine.getRun(id),
  startNode: (runId, nodeId) => workflowEngine.startNode(runId, nodeId),
  execute: async (run, node) => {
    const project = projectService.getProject(run.projectId)
    if (!project) throw new Error('项目不存在')
    const instance = await dynamicAgentFactory.createInstance(node, run, run.config?.defaultAgentId)
    if (run.status !== 'running' || node.status !== 'running') {
      dynamicAgentFactory.terminateInstance(instance.id)
      if (node.status === 'running') await workflowEngine.forceResetNode(run.id, node.id)
      return
    }
    const prompt = dynamicAgentFactory.buildFullPrompt(instance, node.userInput || node.prompt || node.description)
    dynamicAgentFactory.activateInstance(instance.id)
    try {
      const params = { nodeId: node.id, runId: run.id, cwd: project.path }
      if (node.executionMode === 'det' || node.executionMode === 'hyb') {
        if (!node.script) throw new Error('确定性节点缺少脚本')
        const cwd = project.path
        if (node.executionMode === 'det') agentService.executeDET({ ...params, cwd, script: node.script })
        else agentService.executeHYB({ ...params, cwd, script: node.script, agentId: instance.baseAgentId, prompt })
      } else {
        agentService.startTurnAsync({ ...params, agentId: instance.baseAgentId, prompt })
      }
    } catch (error) {
      dynamicAgentFactory.terminateInstance(instance.id)
      throw error
    }
  },
  fail: async (runId, nodeId, error) => {
    const node = workflowEngine.getRun(runId)?.nodes.find(item => item.id === nodeId)
    if (node?.status === 'running') await workflowEngine.submitNodeDecision(runId, nodeId, 'failed', error.message)
    console.error('[AutoStart]', error.message)
  },
})

function requestReadyDispatch(runId: string): void {
  readyDispatcher.request(runId).catch(error => console.error('[AutoStart]', error))
}

// 注册 WorkflowEngine 事件 → 广播给所有 WebSocket 客户端 + 指标采集 + 自动同步
workflowEngine.onEvent((message) => {
  broadcast(message)

  // 指标采集埋点
  if (message.type === 'run:node_updated') {
    const { runId, nodeId, status } = message.payload as { runId?: string; nodeId: string; status: string }
    switch (status) {
      case 'running':
        metricsCollector.recordNodeStart(nodeId)
        break
      case 'wait_user_review':
        metricsCollector.recordNodeWaitReview(nodeId)
        break
      case 'ready': {
        // ★ Phase 2 AutoStart：节点变为 ready 时尝试自动启动
        if (runId) {
          requestReadyDispatch(runId)
        }
        break
      }
      case 'completed': {
        // Skill 自动沉淀：节点完成时异步分析产出物
        if (runId) {
          const run = workflowEngine.getRun(runId)
          const node = run?.nodes.find(n => n.id === nodeId)
          if (run && node) {
            skillExtractionService.extractFromNode(node, run)
              .then(extracted => {
                if (extracted.length > 0) {
                  console.log(`[SkillExtraction] Auto-extracted ${extracted.length} skill(s) from node "${node.name}"`)
                  // 重新加载 Skills 使新沉淀的 Skill 立即可用
                  skillService.loadAdditional([projectService.getSkillsDir(run.projectId) || ''])
                }
              })
              .catch(err => console.warn('[SkillExtraction] Error:', (err as Error).message))
          }
        }
        break
      }
    }
  }

  if (message.type === 'run:node_updated' || message.type === 'run:status_changed') {
    const { runId } = message.payload as { runId?: string }
    if (runId) requestReadyDispatch(runId)
  }

  // Turn 完成时同步记录到 MetricsCollector 运行时缓存
  if (message.type === 'agent:turn_completed') {
    const { turn } = message.payload as { turn: import('./types/index.js').AgentTurn }
    metricsCollector.recordTurnComplete(turn, turn.toolCalls || [], turn.filesModified || 0)
  }

  // 自动同步：Run 状态变化时标记 dirty 并触发 debounce push
  if (message.type === 'run:status_changed' || message.type === 'run:node_updated' || message.type === 'run:deleted') {
    syncService.markDirty()
    debouncedAutoSync()
  }
})

// Debounced auto-sync（防止频繁推送，5秒内只触发一次）
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null
function debouncedAutoSync() {
  if (autoSyncTimer) clearTimeout(autoSyncTimer)
  autoSyncTimer = setTimeout(() => {
    syncService.autoSyncIfNeeded()
  }, 5000)
}

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] Client connected')
  connectedClients.add(ws)

  const terminalSessionId = `term_${Date.now()}`

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      switch (msg.type) {
        case 'sync:request':
          synchronizedClients.delete(ws)
          realtimeReplay.synchronize(msg.payload || {}, raw => ws.send(raw))
          synchronizedClients.add(ws)
          break
        case 'terminal:input':
          if (typeof msg.payload?.data !== 'string') throw new Error('terminal input must be a string')
          terminalService.write(terminalSessionId, msg.payload.data)
          break

        case 'terminal:start': {
          const cwd = fileService.resolveSafePath(msg.payload?.cwd || process.cwd())
          terminalService.createSession(terminalSessionId, ws, cwd)
          break
        }

        case 'file:watch':
          if (typeof msg.payload?.path !== 'string') throw new Error('watch path must be a string')
          fileService.watchDirectory(msg.payload.path, (change) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: `file:${change.type}` as const,
                payload: change,
                timestamp: Date.now(),
              }))
            }
          })
          break

        default:
          console.log('[WS] Unknown message type:', msg.type)
      }
    } catch (err) {
      console.error('[WS] Parse error:', err)
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'server:error',
          payload: { error: (err as Error).message },
          timestamp: Date.now(),
        }))
      }
    }
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
    connectedClients.delete(ws)
    synchronizedClients.delete(ws)
    terminalService.close(terminalSessionId)
  })
})

// ═══════════════ 启动 ═══════════════

async function start() {
  // 加载持久化数据
  await projectService.load()
  await workflowEngine.load()
  await templateService.load()
  await authService.load()
  await contextDBService.initialize()
  await projectService.ensureL0Seeds()
  await metricsCollector.load()
  await l1RuleLifecycleService.start()
  await syncService.load()

  // 启动时尝试从远端拉取最新数据（静默，不中断启动）
  if (syncService.getConfig()?.autoSync) {
    syncService.pull().then(() => {
      console.log('[Sync] Startup pull completed')
    }).catch((err) => {
      console.warn('[Sync] Startup pull failed (non-blocking):', err.message)
    })
  }

  console.log(`[Projects]  Loaded ${projectService.getProjects().length} projects`)
  console.log(`[Templates] Loaded ${templateService.getTemplates().length} workflow templates`)
  console.log(`[Runs]      Loaded ${workflowEngine.getRuns().length} runs`)

  // 加载 Skills（扫描 CatPaw、Claude、Codex 的全局和项目级目录）
  const skillPaths = [
    ...projectService.getProjects().map(project => projectService.getSkillsDir(project.id)!),
    `${process.env.HOME}/.catpaw/skills`,
    `${process.env.HOME}/.claude/skills`,
    `${process.env.HOME}/.codex/skills`,
    `${process.cwd()}/.catpaw/skills`,
    `${process.cwd()}/.claude/skills`,
    `${process.cwd()}/.codex/skills`,
  ]
  const skills = await skillService.loadSkills(skillPaths)
  console.log(`[Skills]    Loaded ${skills.length} skills`)

  server.listen(PORT, HOST, () => {
    console.log(`
┌───────────────────────────────────────────────┐
│     AgentFlow Server v2.9.1                   │
│     MAF-inspired Workflow Engine             │
│                                               │
│  HTTP API:  http://${HOST}:${PORT}/api         │
│  WebSocket: ws://${HOST}:${PORT}/ws           │
│  Health:    http://${HOST}:${PORT}/health      │
│                                               │
│  Core features:                               │
│  • Three-layer state machine                  │
│  • DAG-based workflow orchestration           │
│  • Multi-role Agent system                    │
│  • Agent Turn lifecycle management            │
│  • Structured artifact delivery               │
│  • Repo isolation (worktree/symlink)          │
│  • Skill materialization (whitelist)          │
│  • Permission isolation (RBAC)                │
│  • A2A Protocol (Agent communication)         │
│  • OutputContract validation                  │
│  • Robustness (retry/DLQ/checkpoint)          │
└───────────────────────────────────────────────┘
    `)
  })
}

start().catch(console.error)

// 优雅退出
let shuttingDown = false
async function gracefulShutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.close()
  await agentService.shutdown()
  terminalService.closeAll()
  fileService.unwatchAll()
  a2aProtocolService.dispose()
  robustnessService.dispose()
  // 确保 AutoFlow 自适应状态和 L1 规则在退出前持久化
  await Promise.allSettled([autoFlowEngine.flushState(), l1RuleLifecycleService.stop(), workflowEngine.persist()])
  process.exit(0)
}

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
