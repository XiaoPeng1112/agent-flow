/** 项目信息 */
export interface Project {
  id: string
  name: string
  path: string          // 本地绝对路径
  description?: string
  skills: SkillInfo[]
  createdAt: number
  lastActiveAt: number
}

/** Skill 信息 */
export interface SkillInfo {
  name: string
  path: string
  description: string
  triggers: string[]
}

/** Agent 定义 */
export interface AgentConfig {
  id: string
  name: string
  type: 'codex' | 'claude' | 'custom-cli'
  description: string
}

/** 工作流模板 */
export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
}

/** 工作流步骤 */
export interface WorkflowStep {
  id: string
  name: string
  type: 'requirement' | 'prd' | 'design' | 'ui' | 'development' | 'bugfix' | 'testing'
  description: string
  agentId?: string       // 使用哪个 Agent
  skillName?: string     // 使用哪个 Skill
  prompt?: string        // 默认 prompt
}

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled'

/** 任务记录 */
export interface TaskRecord {
  id: string
  projectId: string
  workflowId?: string
  stepId?: string
  agentId: string
  prompt: string
  output: string
  status: TaskStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
}

/** 活跃 Tab */
export type ProjectTab = 'workflow' | 'skills' | 'tasks' | 'settings'
