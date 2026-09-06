import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { ExecutionWorkspaceStore } from '../services/execution-workspace.js'
import { providerCommand, ProviderStream, type ProviderEvent } from '../services/providers/adapter.js'
import type { ProviderExecution } from '../services/providers/journal.js'
import type { ExecutionJob, ExecutionResult, WorkerMessage } from './protocol.js'
import { groupExists, stopProcessGroup } from './process-group.js'

let child: ChildProcess | undefined
let cancelled = false
let started = false
let authorize: ((execute: boolean) => void) | undefined
let stopping: Promise<void> | undefined
let pendingBytes = 0
let graceMs = 1500
const send = (message: WorkerMessage): void => {
  if (!process.connected) return
  const bytes = Buffer.byteLength(JSON.stringify(message))
  if (pendingBytes + bytes > 40 * 1024 * 1024) throw new Error('Execution IPC buffer limit exceeded')
  pendingBytes += bytes
  process.send!(message, error => {
    pendingBytes -= bytes
    if (error) cancel()
  })
}
function stop(): Promise<void> {
  return stopping ||= child ? stopProcessGroup(child, graceMs) : Promise.resolve()
}
function cancel(): void {
  cancelled = true
  authorize?.(false)
  if (child) void stop().catch(() => { child?.kill('SIGKILL') })
}
process.on('disconnect', cancel)
process.on('SIGTERM', cancel)
process.on('message', message => {
  const command = message as { type: string; job?: ExecutionJob }
  if (command.type === 'cancel') cancel()
  if (command.type === 'execute') authorize?.(!cancelled && process.connected)
  if (command.type === 'start' && !started && command.job) {
    started = true
    void execute(command.job).then(result => {
      if (process.connected) process.send!({ type: 'result', result }, () => process.disconnect())
    }).catch(error => {
      const result: ExecutionResult = { success: false, code: null, cancelled, snapshotOK: false,
        error: (error as Error).message, output: '' }
      if (process.connected) process.send!({ type: 'result', result }, () => process.disconnect())
    })
  }
})

async function execute(job: ExecutionJob): Promise<ExecutionResult> {
  graceMs = job.killGraceMs ?? 1500
  const store = job.workspace && new ExecutionWorkspaceStore(job.workspace.root)
  let cwd = job.cwd
  let output = ''
  let bytes = 0
  let error: string | undefined
  let prepared = false
  let timeout: NodeJS.Timeout | undefined
  let stream: ProviderStream | undefined
  let code: number | null = null
  let snapshotOK = !store
  try {
    if (cancelled || !process.connected) throw new Error('Execution cancelled before preparation')
    if (store && job.workspace) {
      const ws = job.workspace.resumeFromTurnId
        ? store.resume(job.turnId, job.workspace.resumeFromTurnId) : store.prepare(job.workspace.prepare)
      cwd = ws.execution.cwd
      send({ type: 'output', text: `工作区: ${cwd}\n起始版本: ${ws.execution.inputCommit}\n` })
    }
    prepared = true
    // Handshake after synchronous Git work: cancellation/pause during preparation cannot start a CLI.
    const approved = new Promise<boolean>(resolve => { authorize = resolve })
    send({ type: 'prepared', cwd })
    if (!process.connected || cancelled || !await approved) throw new Error('Execution cancelled before process start')
    authorize = undefined
    let providerState: ProviderExecution | undefined
    let sequence = 0
    if (job.agent?.type === 'codex' || job.agent?.type === 'claude') {
      providerState = { provider: job.agent.type, command: job.agent.command, model: job.agent.model, cwd,
        resumedFromTurnId: job.recovery?.resumedFromTurnId }
      store?.providers.set(job.turnId, providerState)
    }
    const emitOutput = (text: string, isResult: boolean) => {
      bytes += Buffer.byteLength(text)
      if (bytes > 32 * 1024 * 1024) throw new Error('Execution output exceeds 32 MiB')
      if (isResult) output += text
      send({ type: 'output', text })
    }
    const receive = (event: ProviderEvent) => {
      if (event.type === 'session' && providerState) {
        if (job.recovery && event.sessionId !== job.recovery.sessionId) throw new Error('Resumed provider session mismatch')
        providerState.sessionId = event.sessionId
        store?.providers.set(job.turnId, providerState)
      }
      store?.providers.append(job.turnId, { sequence: ++sequence, timestamp: Date.now(), event })
      send({ type: 'provider', event })
      if (event.type === 'text') emitOutput(event.text, true)
      if (event.type === 'diagnostic') emitOutput(`\n[Provider] ${event.message}\n`, false)
    }
    if (providerState) stream = new ProviderStream(providerState.provider, receive)
    const invocation = job.agent ? providerCommand(job.agent, job.prompt, job.recovery?.sessionId)
      : { args: ['-c', job.script!], useStdin: false }
    child = spawn(job.agent?.command || 'sh', invocation.args, {
      cwd, env: job.environment, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    })
    const decoder = new StringDecoder('utf8')
    const diagnosticDecoder = new StringDecoder('utf8')
    const fail = (failure: Error) => { error ||= failure.message; void stop().catch(e => { error ||= String(e) }) }
    // Install listeners before writing stdin or persisting the spawned PID.
    const closed = new Promise<number | null>(resolve => {
      child!.once('error', failure => { fail(failure); resolve(null) })
      child!.once('close', resolve)
      child!.once('exit', () => {
        // Descendants may retain stdout or run after their leader exits. They belong to this attempt.
        try {
          if (child?.pid && groupExists(child.pid)) {
            error ||= 'Execution left background processes running'
            void stop().catch(e => { error ||= String(e) })
          }
        } catch (failure) { fail(failure as Error) }
      })
    })
    child.stdout?.on('data', (data: Buffer) => {
      try {
        if (stream) { stream.write(data); if (stream.error) fail(new Error(stream.error)) }
        else emitOutput(decoder.write(data), true)
      } catch (failure) { fail(failure as Error) }
    })
    child.stderr?.on('data', (data: Buffer) => {
      try { emitOutput(diagnosticDecoder.write(data), false) } catch (failure) { fail(failure as Error) }
    })
    child.stdin?.on('error', fail)
    if (child.pid) send({ type: 'spawned', pid: child.pid })
    if (providerState && child.pid) { providerState.pid = child.pid; store?.providers.set(job.turnId, providerState) }
    if (invocation.useStdin) child.stdin?.end(job.prompt)
    else child.stdin?.end()
    timeout = setTimeout(() => { error ||= 'Execution timed out'; void stop().catch(e => { error ||= String(e) }) }, job.timeoutMs)
    code = await closed
    if (stopping) await stopping
    const tail = decoder.end()
    if (tail) emitOutput(tail, true)
    const diagnostics = diagnosticDecoder.end()
    if (diagnostics) emitOutput(diagnostics, false)
    const protocol = stream?.finish()
    if (protocol && !protocol.success) error ||= protocol.error
    if (cancelled) error = '用户取消执行'
    if (code !== 0) error ||= `Process exited with code ${code}`
  } catch (failure) {
    error = prepared ? (failure as Error).message : `工作区准备失败: ${(failure as Error).message}`
    if (child) await stop().catch(() => {})
  } finally { if (timeout) clearTimeout(timeout) }
  // No provider descendants may write while the snapshot is captured.
  if (store && prepared) {
    try { store.snapshot(job.turnId); snapshotOK = true }
    catch (failure) { error ||= `代码快照失败: ${(failure as Error).message}` }
  }
  return { allowFallback: code !== null && code !== 0 && !cancelled && snapshotOK && error === `Process exited with code ${code}`,
    success: code === 0 && !cancelled && !error && snapshotOK, code, cancelled, snapshotOK, error, output,
    tokenUsage: stream?.usage, toolCalls: stream ? [...stream.tools] : undefined,
    filesModified: stream?.kind === 'codex' ? stream.files.size : undefined }
}
