const API_BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

// ===== Project API =====
export async function fetchProjects() {
  return request<{ projects: any[] }>('/projects')
}

export async function createProject(data: { name: string; path: string; description?: string }) {
  return request<{ project: any }>('/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteProject(id: string) {
  return request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' })
}

export async function scanProjectSkills(projectId: string) {
  return request<{ skills: any[] }>(`/projects/${projectId}/skills`)
}

// ===== Agent API =====
export async function fetchAgents() {
  return request<{ agents: any[] }>('/agents')
}

export async function executeAgent(agentId: string, prompt: string, cwd: string) {
  return request<{ task: any }>('/agents/execute', {
    method: 'POST',
    body: JSON.stringify({ agentId, prompt, cwd }),
  })
}

// ===== Task API =====
export async function fetchTasks(projectId?: string) {
  const query = projectId ? `?projectId=${projectId}` : ''
  return request<{ tasks: any[] }>(`/tasks${query}`)
}

// ===== Skill API =====
export async function fetchSkills() {
  return request<{ skills: any[] }>('/skills')
}

export async function fetchSkillDetail(name: string) {
  return request<{ name: string; content: string }>(`/skills/${name}`)
}
