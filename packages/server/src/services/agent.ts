import { spawn } from 'child_process'
import type { AgentConfig, SessionRecord } from '../types/index.js'

/**
 * Agent 调度服务
 * 负责管理和调用不同的 AI Agent（Codex CLI、Claude 等）
 */
export class AgentService {
  private agents: Map<string, AgentConfig> = new Map()
  private sessions: SessionRecord[] = []

  constructor() {
    // 注册默认 Agent
    this.registerAgent({
      id: 'codex',
      name: 'OpenAI Codex CLI',
      type: 'codex',
      command: 'codex',
      description: '使用 OpenAI Codex CLI 进行代码生成和编辑',
    })

    this.registerAgent({
      id: 'claude-cli',
      name: 'Claude CLI',
      type: 'claude',
      command: 'claude',
      description: '使用 Claude CLI (Anthropic) 进行任务执行',
    })
  }

  /** 注册 Agent */
  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config)
  }

  /** 获取所有可用 Agent */
  getAgents(): AgentConfig[] {
    return Array.from(this.agents.values())
  }

  /** 执行 Agent 任务 */
  async execute(
    agentId: string,
    prompt: string,
    options: { cwd?: string; onOutput?: (data: string) => void }
  ): Promise<SessionRecord> {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)

    const record: SessionRecord = {
      id: `session_${Date.now()}`,
      workflowId: '',
      nodeId: '',
      agentId,
      input: prompt,
      output: '',
      status: 'running',
      startedAt: Date.now(),
    }
    this.sessions.push(record)

    return new Promise((resolve, reject) => {
      // 根据 agent type 构建命令
      const args = this.buildArgs(agent, prompt)
      const proc = spawn(agent.command, args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...agent.env },
        shell: true,
      })

      let output = ''

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text
        options.onOutput?.(text)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text
        options.onOutput?.(text)
      })

      proc.on('close', (code) => {
        record.output = output
        record.status = code === 0 ? 'completed' : 'error'
        record.completedAt = Date.now()
        resolve(record)
      })

      proc.on('error', (err) => {
        record.output = err.message
        record.status = 'error'
        record.completedAt = Date.now()
        reject(err)
      })
    })
  }

  /** 获取执行历史 */
  getHistory(): SessionRecord[] {
    return this.sessions
  }

  private buildArgs(agent: AgentConfig, prompt: string): string[] {
    switch (agent.type) {
      case 'codex':
        return [prompt]
      case 'claude':
        return ['-p', prompt]
      case 'custom-cli':
        return [prompt]
      default:
        return [prompt]
    }
  }
}
