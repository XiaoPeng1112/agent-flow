import express from 'express'
import cors from 'cors'
import { WebSocketServer, type WebSocket } from 'ws'
import { createServer } from 'http'
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
import type { WsMessage } from './types/index.js'

const PORT = Number(process.env.PORT) || 3001

// ═══════════════ 初始化服务 ═══════════════

const terminalService = new TerminalService()
const fileService = new FileSystemService()
// 配置文件系统安全：仅允许访问项目工作目录（默认为 cwd）
const allowedFileRoots = (process.env.ALLOWED_FILE_ROOTS || process.cwd()).split(',').map(p => p.trim())
fileService.setAllowedRoots(allowedFileRoots)

const skillService = new SkillService()
const projectService = new ProjectService(skillService)
const workflowEngine = new WorkflowEngine()
const templateService = new TemplateService()
const agentService = new AgentService(workflowEngine)
const authService = new AuthService()
const gitService = new GitService()

// === 新增能力服务 ===
const repoIsolationService = new RepoIsolationService()
const skillMaterializationService = new SkillMaterializationService(skillService)
const permissionIsolationService = new PermissionIsolationService()
const a2aProtocolService = new A2AProtocolService(workflowEngine)
const contractValidatorService = new ContractValidatorService()
const robustnessService = new RobustnessService()
const contextDBService = new ContextDBService()
const dynamicAgentFactory = new DynamicAgentFactory(agentService, workflowEngine, projectService, contextDBService)

// ═══════════════ Express 应用 ═══════════════

const app = express()
app.use(cors())
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
}))

// 健康检查
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.5.0',
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
const wss = new WebSocketServer({ server, path: '/ws' })

// 存储所有连接的客户端
const connectedClients = new Set<WebSocket>()

// 广播消息给所有客户端
function broadcast(message: WsMessage): void {
  const raw = JSON.stringify(message)
  for (const client of connectedClients) {
    if (client.readyState === client.OPEN) {
      client.send(raw)
    }
  }
}

// 注册 WorkflowEngine 事件 → 广播给所有 WebSocket 客户端
workflowEngine.onEvent((message) => {
  broadcast(message)
})

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] Client connected')
  connectedClients.add(ws)

  const terminalSessionId = `term_${Date.now()}`

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      switch (msg.type) {
        case 'terminal:input':
          terminalService.write(terminalSessionId, msg.payload.data)
          break

        case 'terminal:start':
          terminalService.createSession(terminalSessionId, ws, msg.payload?.cwd)
          break

        case 'file:watch':
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
    }
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
    connectedClients.delete(ws)
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

  console.log(`[Projects]  Loaded ${projectService.getProjects().length} projects`)
  console.log(`[Templates] Loaded ${templateService.getTemplates().length} workflow templates`)
  console.log(`[Runs]      Loaded ${workflowEngine.getRuns().length} runs`)

  // 加载 Skills（扫描 CatPaw、Claude、Codex 的全局和项目级目录）
  const skillPaths = [
    `${process.env.HOME}/.catpaw/skills`,
    `${process.env.HOME}/.claude/skills`,
    `${process.env.HOME}/.codex/skills`,
    `${process.cwd()}/.catpaw/skills`,
    `${process.cwd()}/.claude/skills`,
    `${process.cwd()}/.codex/skills`,
  ]
  const skills = await skillService.loadSkills(skillPaths)
  console.log(`[Skills]    Loaded ${skills.length} skills`)

  server.listen(PORT, () => {
    console.log(`
┌───────────────────────────────────────────────┐
│     AgentFlow Server v2.5.0                   │
│     MAF-inspired Workflow Engine             │
│                                               │
│  HTTP API:  http://localhost:${PORT}/api         │
│  WebSocket: ws://localhost:${PORT}/ws           │
│  Health:    http://localhost:${PORT}/health      │
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
function gracefulShutdown() {
  terminalService.closeAll()
  fileService.unwatchAll()
  a2aProtocolService.dispose()
  robustnessService.dispose()
  server.close()
  process.exit(0)
}

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
