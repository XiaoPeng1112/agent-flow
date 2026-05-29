import { create } from 'zustand'
import type {
  Project, Run, TaskNode, AgentTurn, AgentConfig,
  SkillInfo, WorkflowTemplate, RunDetailTab,
} from '../types'

// ═══════════════ Store 接口 ═══════════════

interface AppState {
  // ─── 项目管理（纯数据） ───
  projects: Project[]

  // ─── Run 管理（核心状态机） ───
  runs: Run[]
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
  taskLogContent: string[]

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
  appendTaskLog: (line: string) => void
  clearTaskLog: () => void

  // ─── Actions: WebSocket 事件处理 ───
  handleWsMessage: (msg: { type: string; payload: any }) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // ─── 初始状态 ───
  projects: [],
  runs: [],
  runDetailTab: 'dag',
  agents: [],
  activeTurns: [],
  skills: [],
  templates: [],
  showTaskLog: false,
  taskLogContent: (() => {
    try {
      const saved = localStorage.getItem('agentflow_task_log')
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
  setRuns: (runs) => set({ runs }),

  addRun: (run) => set({ runs: [...get().runs, run] }),

  updateRun: (run) => {
    set({ runs: get().runs.map((r) => (r.id === run.id ? run : r)) })
  },

  removeRun: (id) => {
    set({ runs: get().runs.filter((r) => r.id !== id) })
  },

  setRunDetailTab: (tab) => set({ runDetailTab: tab }),

  // ─── Node 操作 ───
  updateNode: (runId, updatedNode) => {
    set({
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

  addActiveTurn: (turn) => set({ activeTurns: [...get().activeTurns, turn] }),

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
  appendTaskLog: (line) => {
    const newLog = [...get().taskLogContent, line].slice(-200) // 保留最近200条
    set({ taskLogContent: newLog })
    try { localStorage.setItem('agentflow_task_log', JSON.stringify(newLog)) } catch {}
  },
  clearTaskLog: () => {
    set({ taskLogContent: [] })
    try { localStorage.removeItem('agentflow_task_log') } catch {}
  },

  // ─── WebSocket 事件处理 ───
  handleWsMessage: (msg) => {
    const { type, payload } = msg

    switch (type) {
      case 'run:status_changed': {
        const run = get().runs.find((r) => r.id === payload.runId)
        if (run) {
          get().updateRun({ ...run, status: payload.status })
        }
        break
      }

      case 'run:node_updated': {
        const { runId, nodeId, status } = payload
        const run = get().runs.find((r) => r.id === runId)
        if (run) {
          const node = run.nodes.find((n) => n.id === nodeId)
          if (node) {
            get().updateNode(runId, { ...node, status })
          }
        }
        break
      }

      case 'agent:turn_started': {
        const { turn } = payload
        get().addActiveTurn(turn)
        get().appendTaskLog(`[Turn ${turn.turnIndex}] Agent ${turn.agentId} 开始执行`)
        break
      }

      case 'agent:turn_output': {
        const { turnId, chunk } = payload
        get().updateActiveTurn(turnId, {
          output: (get().activeTurns.find((t) => t.id === turnId)?.output || '') + chunk,
        })
        get().appendTaskLog(chunk)
        break
      }

      case 'agent:turn_completed': {
        const { turn } = payload
        // 先更新 tokenUsage 到 activeTurn（供 AgentsPanel 收集）
        if (turn.tokenUsage) {
          get().updateActiveTurn(turn.id, { tokenUsage: turn.tokenUsage, status: 'completed', result: turn.result })
        }
        get().removeActiveTurn(turn.id)
        const tokenInfo = turn.tokenUsage ? ` (${turn.tokenUsage.total} tokens)` : ''
        get().appendTaskLog(`[Turn ${turn.turnIndex}] 执行完成 ✓${tokenInfo}`)
        break
      }

      case 'agent:turn_paused': {
        const { turn, question } = payload
        get().updateActiveTurn(turn.id, { status: 'paused', question })
        get().appendTaskLog(`[Turn ${turn.turnIndex}] Agent 暂停，提问: ${question}`)
        break
      }

      case 'agent:turn_error': {
        const { turn } = payload
        get().removeActiveTurn(turn.id)
        get().appendTaskLog(`[Turn ${turn.turnIndex}] 执行失败 ✗`)
        break
      }
    }
  },
}))
