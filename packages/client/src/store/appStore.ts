import { create } from 'zustand'
import type {
  Project, Run, TaskNode, AgentTurn, AgentConfig,
  SkillInfo, WorkflowTemplate, RunDetailTab,
} from '../types'

// ═══════════════ Task Log 结构化类型 ═══════════════

export type TaskLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface TaskLogEntry {
  id: string
  timestamp: number
  level: TaskLogLevel
  message: string
  /** 可选：关联的节点/turn 信息 */
  meta?: {
    turnIndex?: number
    agentId?: string
    nodeId?: string
    nodeName?: string
    tokens?: number
  }
}

// ═══════════════ Store 接口 ═══════════════

interface AppState {
  // ─── 项目管理（纯数据） ───
  projects: Project[]

  // ─── Run 管理（核心状态机） ───
  runs: Run[]
  runStateVersion: number
  mergeProjectRuns: (projectId: string, runs: Run[], requestedVersion: number) => boolean
  runDetailTab: RunDetailTab

  // ─── Agent ───
  agents: AgentConfig[]
  activeTurns: AgentTurn[]  // 当前正在执行的 turns

  // ─── Skills ───
  skills: SkillInfo[]

  // ─── 工作流模板 ───
  templates: WorkflowTemplate[]

  // ─── UI 状态 ───
  showTaskLog: boolean
  taskLogEntries: TaskLogEntry[]

  // ─── Actions: 项目 ───
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void

  // ─── Actions: Run ───
  setRuns: (runs: Run[]) => void
  addRun: (run: Run) => void
  updateRun: (run: Run) => void
  removeRun: (id: string) => void
  setRunDetailTab: (tab: RunDetailTab) => void

  // ─── Actions: Node（状态机操作） ───
  updateNode: (runId: string, node: TaskNode) => void

  // ─── Actions: Agent Turn ───
  setAgents: (agents: AgentConfig[]) => void
  addActiveTurn: (turn: AgentTurn) => void
  updateActiveTurn: (turnId: string, updates: Partial<AgentTurn>) => void
  removeActiveTurn: (turnId: string) => void

  // ─── Actions: Skills & Templates ───
  setSkills: (skills: SkillInfo[]) => void
  setTemplates: (templates: WorkflowTemplate[]) => void

  // ─── Actions: UI ───
  toggleTaskLog: () => void
  appendTaskLog: (line: string, level?: TaskLogLevel, meta?: TaskLogEntry['meta']) => void
  clearTaskLog: () => void

  // ─── Actions: WebSocket 事件处理 ───
  handleWsMessage: (msg: { type: string; payload: any }) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // ─── 初始状态 ───
  projects: [],
  runs: [],
  runStateVersion: 0,
  runDetailTab: 'dag',
  agents: [],
  activeTurns: [],
  skills: [],
  templates: [],
  showTaskLog: false,
  taskLogEntries: (() => {
    try {
      const saved = localStorage.getItem('agentflow_task_log_v2')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })(),

  // ─── 项目操作 ───
  setProjects: (projects) => set({ projects }),

  addProject: (project) => set({ projects: [...get().projects, project] }),

  removeProject: (id) => {
    set({ projects: get().projects.filter((p) => p.id !== id) })
  },

  // ─── Run 操作 ───
  setRuns: (runs) => set({ runs, runStateVersion: get().runStateVersion + 1 }),

  mergeProjectRuns: (projectId, runs, requestedVersion) => {
    if (get().runStateVersion !== requestedVersion) return false
    set({ runs: [...get().runs.filter(run => run.projectId !== projectId), ...runs.filter(run => run.projectId === projectId)],
      runStateVersion: get().runStateVersion + 1 })
    return true
  },

  addRun: (run) => set({ runs: [...get().runs.filter(r => r.id !== run.id), run], runStateVersion: get().runStateVersion + 1 }),

  updateRun: (run) => {
    set({ runs: get().runs.map((r) => (r.id === run.id ? run : r)), runStateVersion: get().runStateVersion + 1 })
  },

  removeRun: (id) => {
    set({ runs: get().runs.filter((r) => r.id !== id), runStateVersion: get().runStateVersion + 1 })
  },

  setRunDetailTab: (tab) => set({ runDetailTab: tab }),

  // ─── Node 操作 ───
  updateNode: (runId, updatedNode) => {
    set({
      runStateVersion: get().runStateVersion + 1,
      runs: get().runs.map((run) => {
        if (run.id !== runId) return run
        return {
          ...run,
          nodes: run.nodes.map((n) => (n.id === updatedNode.id ? updatedNode : n)),
        }
      }),
    })
  },

  // ─── Agent 操作 ───
  setAgents: (agents) => set({ agents }),

  addActiveTurn: (turn) => set({ activeTurns: [...get().activeTurns.filter(t => t.id !== turn.id), turn] }),

  updateActiveTurn: (turnId, updates) => {
    set({
      activeTurns: get().activeTurns.map((t) =>
        t.id === turnId ? { ...t, ...updates } : t
      ),
    })
  },

  removeActiveTurn: (turnId) => {
    set({ activeTurns: get().activeTurns.filter((t) => t.id !== turnId) })
  },

  // ─── Skills & Templates ───
  setSkills: (skills) => set({ skills }),
  setTemplates: (templates) => set({ templates }),

  // ─── UI ───
  toggleTaskLog: () => set({ showTaskLog: !get().showTaskLog }),

  appendTaskLog: (message, level = 'info', meta) => {
    const entry: TaskLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      level,
      message,
      meta,
    }
    const newEntries = [...get().taskLogEntries, entry].slice(-100) // 保留最近 100 条结构化日志
    set({ taskLogEntries: newEntries })
    try { localStorage.setItem('agentflow_task_log_v2', JSON.stringify(newEntries)) } catch {}
  },

  clearTaskLog: () => {
    set({ taskLogEntries: [] })
    try { localStorage.removeItem('agentflow_task_log_v2') } catch {}
  },

  // ─── WebSocket 事件处理 ───
  handleWsMessage: (msg) => {
    const { type, payload } = msg

    switch (type) {
      case 'sync:snapshot': {
        if (!Array.isArray(payload?.runs) || !Array.isArray(payload?.activeTurns)) throw new Error('Invalid synchronized state')
        set({ runs: payload.runs, activeTurns: payload.activeTurns, runStateVersion: get().runStateVersion + 1 })
        break
      }
      case 'run:deleted': {
        set({ runs: get().runs.filter(run => run.id !== payload.runId),
          runStateVersion: get().runStateVersion + 1,
          activeTurns: get().activeTurns.filter(turn => turn.runId !== payload.runId) })
        break
      }
      case 'run:status_changed': {
        if (payload.run) get().addRun(payload.run)
        const run = get().runs.find((r) => r.id === payload.runId)
        if (run) {
          get().updateRun({ ...run, status: payload.status })
          // 记录 Run 状态变化日志
          const statusLabels: Record<string, string> = {
            running: '开始运行',
            paused: '已暂停',
            completed: '运行完成',
            failed: '运行失败',
          }
          const label = statusLabels[payload.status]
          if (label) {
            const level = payload.status === 'failed' ? 'error'
              : payload.status === 'completed' ? 'success'
              : payload.status === 'paused' ? 'warning' : 'info'
            get().appendTaskLog(`Run ${label}`, level)
          }
        }
        break
      }

      case 'run:node_updated': {
        const { runId, nodeId, status } = payload
        const run = get().runs.find((r) => r.id === runId)
        if (run) {
          const node = run.nodes.find((n) => n.id === nodeId)
          if (node) {
            get().updateNode(runId, payload.node || { ...node, status })
          }
        }
        break
      }

      case 'agent:turn_started': {
        const { turn } = payload
        get().addActiveTurn(turn)
        get().appendTaskLog(
          `Agent ${turn.agentId} 开始执行`,
          'info',
          { turnIndex: turn.turnIndex, agentId: turn.agentId, nodeId: turn.nodeId }
        )
        break
      }

      case 'agent:turn_output': {
        const { turnId, chunk } = payload
        get().updateActiveTurn(turnId, {
          output: (get().activeTurns.find((t) => t.id === turnId)?.output || '') + chunk,
        })
        // 不再将每个 chunk 写入任务日志——实时输出面板已单独展示
        break
      }

      case 'agent:turn_completed': {
        const { turn } = payload
        // 先更新 tokenUsage 到 activeTurn（供 AgentsPanel 收集）
        if (turn.tokenUsage) {
          get().updateActiveTurn(turn.id, { tokenUsage: turn.tokenUsage, status: 'completed', result: turn.result })
        }
        get().removeActiveTurn(turn.id)
        const tokenInfo = turn.tokenUsage ? ` · ${turn.tokenUsage.total.toLocaleString()} tokens` : ''
        get().appendTaskLog(
          `Agent ${turn.agentId} 执行完成${tokenInfo}`,
          'success',
          { turnIndex: turn.turnIndex, agentId: turn.agentId, nodeId: turn.nodeId, tokens: turn.tokenUsage?.total }
        )
        break
      }

      case 'agent:turn_paused': {
        const { turn, question } = payload
        get().updateActiveTurn(turn.id, { status: 'paused', question })
        get().appendTaskLog(
          `Agent 暂停提问: ${question}`,
          'warning',
          { turnIndex: turn.turnIndex, agentId: turn.agentId, nodeId: turn.nodeId }
        )
        break
      }

      case 'agent:turn_error': {
        const { turn } = payload
        get().removeActiveTurn(turn.id)
        get().appendTaskLog(
          `Agent ${turn.agentId} 执行失败`,
          'error',
          { turnIndex: turn.turnIndex, agentId: turn.agentId, nodeId: turn.nodeId }
        )
        break
      }
    }
  },
}))
