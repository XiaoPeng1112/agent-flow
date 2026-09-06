import { StringDecoder } from 'string_decoder'
import type { AgentConfig, TokenUsage } from '../../types/index.js'

export type ProviderKind = 'codex' | 'claude'
export type ProviderEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; status: string }
  | { type: 'file'; path: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'completed'; success: boolean; error?: string }
  | { type: 'diagnostic'; message: string }

export function providerCommand(agent: AgentConfig, prompt: string, sessionId?: string): { args: string[]; useStdin: boolean } {
  if (sessionId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sessionId)) throw new Error('Invalid provider session ID')
  if (agent.type === 'codex') {
    // Parent exec options precede resume: resume itself has no --sandbox flag.
    const args = ['exec', '--sandbox', 'workspace-write', '--json']
    if (agent.model) args.push('--model', agent.model)
    args.push(...(sessionId ? ['resume', sessionId, '-'] : ['-']))
    return { args, useStdin: true }
  }
  if (agent.type === 'claude') {
    const args = ['--print', '--output-format', 'stream-json', '--verbose']
    if (agent.model) args.push('--model', agent.model)
    if (sessionId) args.push('--resume', sessionId)
    // Text input on stdin avoids exposing prompts in process arguments.
    return { args, useStdin: true }
  }
  if (sessionId) throw new Error('This provider does not support session recovery')
  return { args: [prompt], useStdin: false }
}

const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a protocol object')
  return value as Record<string, any>
}
const count = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid token count')
  return value
}

/** Bounded JSONL decoder. Transport chunks are not lines or necessarily complete UTF-8 characters. */
export class ProviderStream {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  private bytes = 0
  private records = 0
  private terminal = false
  private failed = false
  private sessionId?: string
  private seen = new Set<string>()
  private lastAssistantText = ''
  private problem?: string
  usage?: TokenUsage
  readonly tools = new Set<string>()
  readonly files = new Set<string>()

  constructor(readonly kind: ProviderKind, private emit: (event: ProviderEvent) => void) {}

  write(chunk: Buffer): void {
    if (this.problem) return
    try {
      this.bytes += chunk.length
      if (this.bytes > 32 * 1024 * 1024) throw new Error('Provider output exceeds 32 MiB')
      this.pending += this.decoder.write(chunk)
      let newline: number
      while ((newline = this.pending.indexOf('\n')) >= 0) {
        const line = this.pending.slice(0, newline).trim()
        this.pending = this.pending.slice(newline + 1)
        if (line) this.line(line)
      }
      if (Buffer.byteLength(this.pending) > 1024 * 1024) throw new Error('Provider event exceeds 1 MiB')
    } catch (error) { this.problem = (error as Error).message }
  }

  get error(): string | undefined { return this.problem }

  finish(): { success: boolean; error?: string } {
    if (!this.problem) {
      try {
        this.pending += this.decoder.end()
        if (this.pending.trim()) this.line(this.pending.trim())
      } catch (error) { this.problem = (error as Error).message }
    }
    this.pending = ''
    const error = this.problem || (!this.sessionId ? 'Provider session event missing' :
      !this.terminal ? 'Provider completion event missing' : this.failed ? 'Provider reported failure' : undefined)
    return { success: !error, error }
  }

  private line(line: string): void {
    if (Buffer.byteLength(line) > 1024 * 1024 || ++this.records > 10_000) throw new Error('Provider event limit exceeded')
    const event = object(JSON.parse(line))
    if (typeof event.type !== 'string') throw new Error('Provider event type missing')
    if (this.kind === 'codex') this.codex(event)
    else this.claude(event)
  }

  private session(id: unknown): void {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('Invalid provider session ID')
    if (this.sessionId && this.sessionId !== id) throw new Error('Provider changed session during execution')
    if (!this.sessionId) { this.sessionId = id; this.emit({ type: 'session', sessionId: id }) }
  }

  private complete(success: boolean, error?: string): void {
    if (this.terminal) throw new Error('Duplicate provider completion')
    this.terminal = true
    this.failed ||= !success
    this.emit({ type: 'completed', success: success && !this.failed, error })
  }

  private tokens(value: unknown): void {
    if (!value) return
    const usage = object(value)
    const input = count(usage.input_tokens) + (this.kind === 'claude'
      ? count(usage.cache_read_input_tokens ?? 0) + count(usage.cache_creation_input_tokens ?? 0) : 0)
    const output = count(usage.output_tokens)
    if (!Number.isSafeInteger(input + output)) throw new Error('Token count overflow')
    this.usage = { input, output, total: input + output }
    this.emit({ type: 'usage', usage: this.usage })
  }

  private once(key: string): boolean {
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }

  private codex(event: Record<string, any>): void {
    switch (event.type) {
      case 'thread.started': this.session(event.thread_id); break
      case 'turn.completed': this.tokens(event.usage); this.complete(true); break
      case 'turn.failed': this.complete(false, event.error?.message || 'Codex turn failed'); break
      case 'error':
        this.failed = true
        this.emit({ type: 'diagnostic', message: String(event.message || 'Codex error').slice(0, 4000) })
        break
      case 'item.completed': {
        if (this.terminal) throw new Error('Provider item after completion')
        const item = object(event.item)
        if (typeof item.id !== 'string' || typeof item.type !== 'string') throw new Error('Invalid Codex item')
        if (!this.once(`item:${item.id}`)) break
        if (item.type === 'agent_message' && typeof item.text === 'string') this.emit({ type: 'text', text: `${item.text}\n` })
        if (['command_execution', 'mcp_tool_call', 'web_search'].includes(item.type)) {
          const name = item.type === 'mcp_tool_call' ? `${item.server}/${item.tool}` : item.type
          this.tools.add(name)
          this.emit({ type: 'tool', id: item.id, name, status: String(item.status || 'completed') })
        }
        if (item.type === 'file_change') {
          if (!Array.isArray(item.changes)) throw new Error('Invalid file change event')
          for (const change of item.changes) {
            if (typeof change?.path !== 'string') throw new Error('Invalid changed path')
            this.files.add(change.path)
            this.emit({ type: 'file', path: change.path })
          }
        }
        break
      }
      // Reasoning and tool payloads are intentionally not copied to user-facing output.
    }
  }

  private claude(event: Record<string, any>): void {
    // Subagent messages do not describe the primary session/result.
    if (event.parent_tool_use_id) return
    if (event.type === 'system' && event.subtype === 'init') this.session(event.session_id)
    if (event.type === 'assistant') {
      if (this.terminal) throw new Error('Provider message after completion')
      const message = object(event.message)
      if (!Array.isArray(message.content)) throw new Error('Invalid Claude assistant content')
      if (event.uuid && !this.once(`message:${event.uuid}`)) return
      const messageText = message.content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text).join('\n')
      if (messageText) this.lastAssistantText = messageText
      for (const block of message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          this.emit({ type: 'text', text: `${block.text}\n` })
        }
        if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string' && this.once(`tool:${block.id}`)) {
          this.tools.add(block.name)
          this.emit({ type: 'tool', id: block.id, name: block.name, status: 'requested' })
        }
      }
    }
    if (event.type === 'result') {
      this.session(event.session_id)
      this.tokens(event.usage)
      if (typeof event.result === 'string' && event.result.trim() !== this.lastAssistantText.trim()) this.emit({ type: 'text', text: `${event.result}\n` })
      if (typeof event.is_error !== 'boolean' || typeof event.subtype !== 'string') throw new Error('Invalid Claude result')
      const denied = Array.isArray(event.permission_denials) && event.permission_denials.length > 0
      this.complete(event.subtype === 'success' && !event.is_error && !denied,
        denied ? 'Required tool permissions denied' : event.is_error ? 'Claude result failed' : undefined)
    }
  }
}
