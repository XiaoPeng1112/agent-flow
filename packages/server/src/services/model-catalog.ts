import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { executionEnvironment } from './execution-environment.js'

export interface ModelOption { id: string; name: string; discovered?: boolean }
export interface ModelCatalog { models: ModelOption[]; source: 'cli' | 'builtin'; fetchedAt?: number; warning?: string }
export const codexModels: ModelOption[] = [
  ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-5.6-sol', 'GPT-5.6 Sol'],
  ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna'],
  ['gpt-5.5', 'GPT-5.5'], ['gpt-5.4-mini', 'GPT-5.4 Mini'], ['gpt-5.3-codex-spark', 'GPT-5.3 Codex Spark'],
].map(([id, name]) => ({ id, name }))
export function validModel(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value))
}

/** Read-only model discovery: no thread, turn, command execution or config mutation. */
export function discoverCodexModels(command = 'codex', timeoutMs = 10_000): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: executionEnvironment('codex') })
    const decoder = new StringDecoder('utf8')
    let buffer = '', bytes = 0, requestId = 0, done = false
    const models = new Map<string, ModelOption>(), cursors = new Set<string>()
    const finish = (error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.stdin.end()
      child.kill('SIGTERM')
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 500)
      killTimer.unref()
      child.once('close', () => clearTimeout(killTimer))
      if (error) reject(error)
      else resolve([...models.values()])
    }
    const send = (method: string, params: object, id?: number) => child.stdin.write(JSON.stringify({ method, params, ...(id === undefined ? {} : { id }) }) + '\n')
    const list = (cursor?: string) => send('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }, ++requestId)
    const timer = setTimeout(() => finish(new Error('Codex 模型列表读取超时')), timeoutMs)
    child.on('error', () => finish(new Error('无法启动 Codex CLI')))
    child.stdin.on('error', () => finish(new Error('Codex 连接已关闭')))
    child.stderr.resume()
    child.on('close', () => { if (!done) finish(new Error('Codex 未返回完整模型列表')) })
    child.stdout.on('data', (chunk: Buffer) => {
      if (done) return
      bytes += chunk.length
      if (bytes > 2 * 1024 * 1024) return finish(new Error('Codex 模型响应过大'))
      buffer += decoder.write(chunk)
      while (buffer.includes('\n') && !done) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id !== requestId || msg.method) continue
          if (msg.error) throw new Error('Codex 模型接口返回错误')
          if (requestId === 0) { send('initialized', {}); list(); continue }
          if (!Array.isArray(msg.result?.data)) throw new Error('Codex 模型响应格式无效')
          for (const row of msg.result.data) {
            if (row.hidden || !validModel(row.model) || !row.model) continue
            models.set(row.model, { id: row.model, name: typeof row.displayName === 'string' ? row.displayName : row.model })
          }
          const cursor = msg.result.nextCursor
          if (cursor != null) {
            if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || cursors.size >= 20) throw new Error('Codex 模型分页无效')
            cursors.add(cursor); list(cursor)
          } else {
            if (!models.size) throw new Error('Codex 返回的模型列表为空')
            finish()
          }
        } catch (error) { finish(error instanceof Error ? error : new Error('Codex 模型响应无效')) }
      }
    })
    send('initialize', { clientInfo: { name: 'agent_flow', title: 'AgentFlow', version: '0.1.0' } }, 0)
  })
}

export class ModelCatalogService {
  private cached?: ModelCatalog
  private pending?: Promise<ModelCatalog>
  constructor(private discover = discoverCodexModels) {}
  async get(refresh = false): Promise<ModelCatalog> {
    if (this.pending) return this.pending
    if (!refresh && this.cached && Date.now() - (this.cached.fetchedAt || 0) < 300_000) return this.cached
    this.pending = this.discover().then(models => {
      const found = new Set(models.map(model => model.id))
      const choices = [...models.map(model => ({ ...model, discovered: true })), ...codexModels.filter(model => !found.has(model.id))]
      this.cached = { models: choices, source: 'cli', fetchedAt: Date.now() }
      return this.cached
    }).catch(() => ({ ...(this.cached || { models: codexModels, source: 'builtin' as const }),
      warning: this.cached ? '刷新失败，显示上次 CLI 列表；当前可用性未验证' : '无法读取 CLI，显示内置候选；可用性未验证' }))
      .finally(() => { this.pending = undefined })
    return this.pending
  }
}
