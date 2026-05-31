/**
 * AgentFlow API Client
 * 与后端 REST API 对接
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  const json = await res.json()
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Request failed: ${res.status}`)
  }
  return json.data ?? json
}

// ═══════════════ Project API ═══════════════

export const projectApi = {
  list: () => request<{ projects: any[] }>('/projects'),

  create: (data: { name: string; path: string; description?: string }) =>
    request<{ project: any }>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; description?: string; contextConfig?: any; enabledAgentIds?: string[] }) =>
    request<{ project: any }>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getSkills: (id: string) =>
    request<{ skills: any[] }>(`/projects/${id}/skills`),

  /** 获取项目启用的 Agent 列表 */
  getEnabledAgents: (id: string) =>
    request<{ enabledAgentIds: string[]; allAgentIds: string[] }>(`/projects/${id}/enabled-agents`),

  /** 更新项目启用的 Agent 列表 */
  updateEnabledAgents: (id: string, enabledAgentIds: string[]) =>
    request<{ project: any }>(`/projects/${id}/enabled-agents`, {
      method: 'PUT',
      body: JSON.stringify({ enabledAgentIds }),
    }),
}

// ═══════════════ Template API ═══════════════

export const templateApi = {
  list: () => request<{ templates: any[] }>('/templates'),

  get: (id: string) => request<{ template: any }>(`/templates/${id}`),

  create: (data: any) =>
    request<{ template: any }>('/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/templates/${id}`, { method: 'DELETE' }),
}

// ═══════════════ Run API ═══════════════

export const runApi = {
  list: (projectId?: string) =>
    request<{ runs: any[] }>(`/runs${projectId ? `?projectId=${projectId}` : ''}`),

  get: (id: string) => request<{ run: any }>(`/runs/${id}`),

  create: (data: { projectId: string; templateId: string; name?: string }) =>
    request<{ run: any }>('/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  start: (id: string) =>
    request<{ run: any }>(`/runs/${id}/start`, { method: 'POST' }),

  pause: (id: string) =>
    request<{ run: any }>(`/runs/${id}/pause`, { method: 'POST' }),

  resume: (id: string) =>
    request<{ run: any }>(`/runs/${id}/resume`, { method: 'POST' }),

  delete: (id: string) =>
    request<void>(`/runs/${id}`, { method: 'DELETE' }),

  getTokenStats: (id: string) =>
    request<{ data: { totalInput: number; totalOutput: number; totalTokens: number; byNode: any[]; estimatedCost?: { usd: number; breakdown: string } } }>(`/runs/${id}/token-stats`),
}

// ═══════════════ Node API ═══════════════

export const nodeApi = {
  start: (runId: string, nodeId: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/start`, { method: 'POST' }),

  submit: (runId: string, nodeId: string, decision: string, error?: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ decision, error }),
    }),

  approve: (runId: string, nodeId: string, feedback?: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  reject: (runId: string, nodeId: string, feedback?: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  skip: (runId: string, nodeId: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/skip`, { method: 'POST' }),

  rollback: (runId: string, nodeId: string) =>
    request<{ run: any }>(`/runs/${runId}/nodes/${nodeId}/rollback`, { method: 'POST' }),

  forceReset: (runId: string, nodeId: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/force-reset`, { method: 'POST' }),

  getArtifacts: (runId: string, nodeId: string) =>
    request<{ artifacts: any[] }>(`/runs/${runId}/nodes/${nodeId}/artifacts`),

  addArtifact: (runId: string, nodeId: string, data: any) =>
    request<{ artifact: any }>(`/runs/${runId}/nodes/${nodeId}/artifacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// ═══════════════ Agent API ═══════════════

export const agentApi = {
  list: () => request<{ agents: any[] }>('/agents'),

  /** 获取 Agent 列表含 CLI 可用性状态 */
  getStatus: () => request<{ agents: any[] }>('/agents/status'),

  getByRole: (role: string) => request<{ agents: any[] }>(`/agents/role/${role}`),

  /** 获取当前活跃 Turn 列表 */
  getActiveTurns: () => request<{ activeTurnIds: string[] }>('/agents/active-turns'),

  executeTurn: (data: {
    agentId: string
    nodeId: string
    runId: string
    prompt: string
    cwd?: string
    contextArtifacts?: string[]
  }) =>
    request<{ turnId: string }>('/agents/execute-turn', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 执行 DET/HYB 模式 */
  executeDET: (data: {
    nodeId: string
    runId: string
    script: string
    cwd?: string
    executionMode?: 'det' | 'hyb'
    agentId?: string
    prompt?: string
  }) =>
    request<{ turnId: string }>('/agents/execute-det', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  cancelTurn: (turnId: string) =>
    request<{ cancelled: boolean }>('/agents/cancel-turn', {
      method: 'POST',
      body: JSON.stringify({ turnId }),
    }),

  answerQuestion: (data: {
    nodeId: string
    runId: string
    agentId: string
    originalQuestion: string
    answer: string
    cwd?: string
  }) =>
    request<{ turnId: string }>('/agents/answer', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getNodeTurns: (nodeId: string) =>
    request<{ turns: any[] }>(`/agents/turns/${nodeId}`),

  /** 动态 Agent: 执行（创建实例 + 构建 context + 启动 Turn）*/
  executeDynamic: (data: {
    nodeId: string
    runId: string
    userInput: string
    preferredAgentId?: string
    cwd?: string
  }) =>
    request<{ turnId: string; instanceId: string; instanceName: string }>('/agents/execute-dynamic', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 动态 Agent: 获取 Run 下所有实例 */
  getInstances: (runId: string) =>
    request<{ instances: any[] }>(`/agents/instances/${runId}`),

  /** 动态 Agent: 获取节点关联实例 */
  getNodeInstance: (runId: string, nodeId: string) =>
    request<{ instance: any }>(`/agents/instances/${runId}/${nodeId}`),
}

// ═══════════════ Diff Review API (产出物闭环) ═══════════════

export const diffReviewApi = {
  /** 生成 Diff Review */
  create: (runId: string, nodeId: string, turnId: string) =>
    request<{ review: any }>(`/runs/${runId}/nodes/${nodeId}/diff-review`, {
      method: 'POST',
      body: JSON.stringify({ turnId }),
    }),

  /** 获取节点的 Diff Reviews */
  getForNode: (runId: string, nodeId: string) =>
    request<{ reviews: any[] }>(`/runs/${runId}/nodes/${nodeId}/diff-review`),

  /** 获取指定文件的详细 Diff */
  getFileDiff: (runId: string, nodeId: string, turnId: string, filePath: string) =>
    request<{ fileDiff: any }>(`/runs/${runId}/nodes/${nodeId}/diff-review/${turnId}/file?path=${encodeURIComponent(filePath)}`),

  /** 合入工作分支 */
  merge: (runId: string, nodeId: string, turnId: string, strategy?: string) =>
    request<{ success: boolean; mergeCommit?: string; filesAffected: number }>(`/runs/${runId}/nodes/${nodeId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ turnId, strategy }),
    }),

  /** 丢弃工作分支 */
  discard: (runId: string, nodeId: string, turnId: string) =>
    request<{ success: boolean }>(`/runs/${runId}/nodes/${nodeId}/discard`, {
      method: 'POST',
      body: JSON.stringify({ turnId }),
    }),
}

// ═══════════════ Metrics API (可观测性) ═══════════════

export const metricsApi = {
  /** 获取 Run 的完整指标 */
  getRunMetrics: (runId: string) =>
    request<{ metrics: any }>(`/runs/${runId}/metrics`),

  /** 获取 Token 分布 */
  getTokenDistribution: (runId: string) =>
    request<{ distribution: any[] }>(`/runs/${runId}/metrics/token-distribution`),

  /** 获取效率表格 */
  getEfficiency: (runId: string) =>
    request<{ table: any[] }>(`/runs/${runId}/metrics/efficiency`),

  /** 获取趋势对比 */
  getTrend: (templateId: string) =>
    request<{ trend: any[] }>(`/metrics/trend/${templateId}`),
}

// ═══════════════ Skill API ═══════════════

export const skillApi = {
  list: () => request<{ skills: any[] }>('/skills'),

  get: (name: string) => request<any>(`/skills/${name}`),

  reload: (paths?: string[]) =>
    request<{ skills: any[]; count: number }>('/skills/reload', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),
}

// ═══════════════ Auth API (GitHub OAuth) ═══════════════

export const authApi = {
  /** 获取 GitHub OAuth 授权 URL */
  getAuthUrl: () => request<{ url: string; configured: boolean }>('/auth/github'),

  /** 获取当前登录用户 */
  me: () => request<{ user: any; authenticated: boolean }>('/auth/me'),

  /** 登出 */
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  /** 获取 GitHub repos 列表 */
  getRepos: () => request<{ repos: any[] }>('/auth/repos'),
}

// ═══════════════ Robustness API (Checkpoint & Health) ═══════════════

export const robustnessApi = {
  /** 获取 Run 的 Checkpoint 列表 */
  getCheckpoints: (runId: string) =>
    request<{ checkpoints: any[] }>(`/robustness/checkpoints/${runId}`),

  /** 创建 Checkpoint */
  createCheckpoint: (runId: string, description?: string) =>
    request<{ checkpoint: any }>(`/robustness/checkpoints/${runId}`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),

  /** 恢复到 Checkpoint */
  restoreCheckpoint: (runId: string, checkpointId: string) =>
    request<{ run: any }>(`/robustness/checkpoints/${runId}/restore/${checkpointId}`, {
      method: 'POST',
    }),

  /** 获取系统健康状态 */
  getHealth: () => request<any>('/robustness/health'),
}

// ═══════════════ Context DB API (四层上下文数据库) ═══════════════

export const contextDBApi = {
  /** 获取 Context DB 统计 */
  getStats: () => request<{ sys: number; l0: number; l1: number; l2: number; totalFiles: number }>('/context-db/stats'),

  /** 列出某层级的文件列表 */
  listFiles: (level: string, scopeId: string) =>
    request<{ files: Array<{ filename: string; level: string; scopeId: string; size: number }> }>(`/context-db/${level}/${scopeId}`),

  /** 读取上下文文件 */
  getFile: (level: string, scopeId: string, filename: string) =>
    request<{ content: string; level: string; scopeId: string; filename: string }>(`/context-db/${level}/${scopeId}/${filename}`),

  /** 创建/更新上下文文件 */
  upsertFile: (level: string, scopeId: string, filename: string, content: string) =>
    request<{ path: string }>(`/context-db/${level}/${scopeId}/${filename}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  /** 删除上下文文件 */
  deleteFile: (level: string, scopeId: string, filename: string) =>
    request<{ deleted: boolean }>(`/context-db/${level}/${scopeId}/${filename}`, {
      method: 'DELETE',
    }),

  /** 装配上下文 */
  assemble: (params: { projectId?: string; templateId?: string; nodeId?: string }) =>
    request<{ layers: any[]; formatted: string; totalLayers: number }>('/context-db/assemble', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
}

// ═══════════════ A2A Protocol API (Agent-to-Agent 通信) ═══════════════

export const a2aApi = {
  /** 获取 Run 的所有 A2A 消息 */
  getMessages: (runId: string) =>
    request<{ messages: any[] }>(`/a2a/messages/${runId}`),

  /** 获取 A2A 统计 */
  getStats: (runId?: string) =>
    request<any>(`/a2a/stats${runId ? `?runId=${runId}` : ''}`),

  /** 获取 Agent 收件箱 */
  getInbox: (agentId: string, filters?: { status?: string; type?: string; runId?: string }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.type) params.set('type', filters.type)
    if (filters?.runId) params.set('runId', filters.runId)
    const qs = params.toString()
    return request<{ messages: any[] }>(`/a2a/inbox/${agentId}${qs ? `?${qs}` : ''}`)
  },

  /** 发送 A2A 消息 */
  send: (data: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    type: string
    payload: unknown
    priority?: string
    requiresAck?: boolean
  }) =>
    request<{ message: any }>('/a2a/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 委派任务 */
  delegate: (data: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    task: { title: string; intent: string; context?: string }
    priority?: string
  }) =>
    request<{ message: any }>('/a2a/delegate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 确认消息 */
  acknowledge: (messageId: string) =>
    request<{ success: boolean }>(`/a2a/ack/${messageId}`, { method: 'POST' }),

  /** 解决消息 */
  resolve: (messageId: string, result?: unknown) =>
    request<{ success: boolean }>(`/a2a/resolve/${messageId}`, {
      method: 'POST',
      body: JSON.stringify({ result }),
    }),

  /** 创建通信通道 */
  createChannel: (runId: string, participants: string[]) =>
    request<{ channel: any }>('/a2a/channels', {
      method: 'POST',
      body: JSON.stringify({ runId, participants }),
    }),
}

// ═══════════════ WebSocket（带生命周期管理的重连机制） ═══════════════

/**
 * 可管理的 WebSocket 连接
 * - 自动重连（3s 间隔）
 * - 外部可通过 dispose() 彻底关闭，不再重连
 * - 避免内存泄漏：dispose 后不会创建新连接
 */
export interface ManagedWebSocket {
  /** 彻底关闭连接并停止重连 */
  dispose: () => void
  /** 获取当前底层 WebSocket 实例（可能为 null） */
  getSocket: () => WebSocket | null
}

export function createWebSocket(onMessage: (msg: any) => void): ManagedWebSocket {
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws'
  let disposed = false
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (disposed) return
    ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        onMessage(msg)
      } catch (err) {
        console.error('[WS] Parse error:', err)
      }
    }

    ws.onclose = () => {
      if (disposed) return
      console.log('[WS] Disconnected, reconnecting in 3s...')
      reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      // onerror 后一般会触发 onclose，这里不需要额外处理
    }
  }

  connect()

  return {
    dispose() {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null // 防止 close 回调里再重连
        ws.close()
        ws = null
      }
    },
    getSocket() {
      return ws
    },
  }
}
