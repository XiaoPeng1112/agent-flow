import { describe, expect, it } from 'vitest'
import { ProviderStream, providerCommand, type ProviderEvent } from '../src/services/providers/adapter.js'

const codexSession = { type: 'thread.started', thread_id: 'session_1' }
const codexDone = { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 9 } }
function decode(provider: 'codex' | 'claude', records: unknown[]) {
  const events: ProviderEvent[] = []
  const stream = new ProviderStream(provider, event => events.push(event))
  stream.write(Buffer.from(records.map(record => JSON.stringify(record)).join('\n')))
  return { stream, events, result: stream.finish() }
}

describe('Provider adapters', () => {
  it('decodes fragmented UTF-8 JSONL and exact Codex usage without parsing prose', () => {
    const events: ProviderEvent[] = []
    const stream = new ProviderStream('codex', event => events.push(event))
    const message = { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: '你好 tokens used 99999' } }
    const data = Buffer.from([codexSession, message, message, codexDone].map(e => JSON.stringify(e)).join('\r\n'))
    for (const byte of data) stream.write(Buffer.from([byte]))
    expect(stream.finish().success).toBe(true)
    expect(events.filter(e => e.type === 'text')).toEqual([{ type: 'text', text: '你好 tokens used 99999\n' }])
    expect(stream.usage).toEqual({ input: 100, output: 9, total: 109 })
  })
  it.each([
    [codexSession],
    [codexDone],
    [codexSession, { type: 'turn.failed', error: { message: 'quota exceeded' } }],
    [codexSession, { type: 'error', message: 'failed' }, codexDone],
    [codexSession, codexDone, codexDone],
    [codexSession, { type: 'turn.completed', usage: { input_tokens: '100', output_tokens: 1 } }],
    [codexSession, { type: 'thread.started', thread_id: 'other' }, codexDone],
  ])('fails closed on missing/failed/invalid lifecycle events (%j)', (...events) => {
    expect(decode('codex', events).result.success).toBe(false)
  })
  it('rejects corrupt and oversized protocol output', () => {
    for (const text of ['not json\n', '{"type":', 'x'.repeat(1024 * 1024 + 1)]) {
      const stream = new ProviderStream('codex', () => {})
      stream.write(Buffer.from(text))
      expect(stream.finish().success).toBe(false)
    }
  })
  it('handles Claude full assistant messages, subagents, permission denials and cached usage', () => {
    const init = { type: 'system', subtype: 'init', session_id: 'claude_1' }
    const message = { type: 'assistant', uuid: 'm1', message: { content: [
      { type: 'text', text: 'Done' }, { type: 'tool_use', id: 'tool1', name: 'Read', input: { secret: 'not retained' } },
    ] } }
    const result = { type: 'result', subtype: 'success', is_error: false, session_id: 'claude_1', result: 'Done',
      usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 5 } }
    const decoded = decode('claude', [init, message, message, { ...message, parent_tool_use_id: 'subtask', uuid: 'sub' }, result])
    expect(decoded.result.success).toBe(true)
    expect(decoded.events.filter(e => e.type === 'text')).toHaveLength(1)
    expect([...decoded.stream.tools]).toEqual(['Read'])
    expect(decoded.stream.usage).toEqual({ input: 60, output: 5, total: 65 })
    expect(JSON.stringify(decoded.events)).not.toContain('not retained')
    expect(decode('claude', [init, { ...result, permission_denials: [{ tool_name: 'Bash' }] }]).result.success).toBe(false)
    expect(decode('claude', [init, { ...result, is_error: true }]).result.success).toBe(false)
  })
  it('uses scoped resume flags and does not silently enable full access or choose the latest session', () => {
    const base = { id: 'agent', name: 'Agent', role: 'executor' as const, command: 'codex', type: 'codex' as const }
    expect(providerCommand(base, 'secret', 'session_1')).toEqual({
      args: ['exec', '--sandbox', 'workspace-write', '--json', 'resume', 'session_1', '-'], useStdin: true,
    })
    const claude = providerCommand({ ...base, type: 'claude' }, 'secret', 'session_1')
    expect(claude.args).toContain('stream-json')
    expect(claude.args).toContain('--resume')
    expect(claude.args).not.toContain('--no-input')
    expect(claude.args).not.toContain('secret')
    expect(() => providerCommand(base, '', '--last')).toThrow()
    expect(() => providerCommand(base, '', '../foreign')).toThrow()
  })
})
