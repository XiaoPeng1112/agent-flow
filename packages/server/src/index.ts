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

const PORT = Number(process.env.PORT) || 3001

// ========== 初始化服务 ==========
const terminalService = new TerminalService()
const agentService = new AgentService()
const fileService = new FileSystemService()
const skillService = new SkillService()
const projectService = new ProjectService(skillService)

// ========== Express 应用 ==========
const app = express()
app.use(cors())
app.use(express.json())

// API 路由
app.use('/api', createApiRouter({ agentService, fileService, skillService, projectService }))

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

// ========== HTTP + WebSocket 服务 ==========
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] Client connected')

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

        case 'terminal:resize':
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
    terminalService.close(terminalSessionId)
  })
})

// ========== 启动 ==========
async function start() {
  // 加载已保存的项目数据
  await projectService.load()
  console.log(`[Projects] Loaded ${projectService.getProjects().length} projects`)

  // 初始加载 Skills
  const skillPaths = [
    `${process.env.HOME}/.catpaw/skills`,
    `${process.cwd()}/.catpaw/skills`,
  ]
  const skills = await skillService.loadSkills(skillPaths)
  console.log(`[Skills] Loaded ${skills.length} skills`)

  server.listen(PORT, () => {
    console.log(`
┌─────────────────────────────────────────┐
│     AgentFlow Dashboard Server          │
│                                         │
│  HTTP API:  http://localhost:${PORT}/api   │
│  WebSocket: ws://localhost:${PORT}/ws     │
│  Health:    http://localhost:${PORT}/health│
└─────────────────────────────────────────┘
    `)
  })
}

start().catch(console.error)

// 优雅退出
process.on('SIGTERM', () => {
  terminalService.closeAll()
  fileService.unwatchAll()
  server.close()
  process.exit(0)
})
