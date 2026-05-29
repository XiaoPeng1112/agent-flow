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

  update: (id: string, data: { name?: string; description?: string; contextConfig?: any }) =>
    request<{ project: any }>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getSkills: (id: string) =>
    request<{ skills: any[] }>(`/projects/${id}/skills`),
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

  delete: (id: string) =>
    request<void>(`/runs/${id}`, { method: 'DELETE' }),
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

  approve: (runId: string, nodeId: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/approve`, { method: 'POST' }),

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

// ═══════════════ WebSocket ═══════════════

export function createWebSocket(onMessage: (msg: any) => void): WebSocket {
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws'
  const ws = new WebSocket(wsUrl)

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      onMessage(msg)
    } catch (err) {
      console.error('[WS] Parse error:', err)
    }
  }

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 3s...')
    setTimeout(() => createWebSocket(onMessage), 3000)
  }

  return ws
}
