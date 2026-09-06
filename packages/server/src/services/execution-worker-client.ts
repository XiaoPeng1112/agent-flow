import { fork, type ChildProcess } from 'child_process'
import { fileURLToPath } from 'url'
import { executionEnvironment } from './execution-environment.js'
import type { ExecutionJob, ExecutionResult, WorkerMessage } from '../workers/protocol.js'

export class ExecutionWorkerClient {
  readonly result: Promise<ExecutionResult>
  readonly worker: ChildProcess
  private settled = false
  private cancelled = false
  private providerPid?: number
  private killTimer?: NodeJS.Timeout
  private deadline: NodeJS.Timeout
  private finish!: (result: ExecutionResult) => void

  constructor(job: ExecutionJob, receive: (message: WorkerMessage) => void, canExecute: () => boolean) {
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
    this.result = new Promise(resolve => { this.finish = resolve })
    this.worker = fork(fileURLToPath(new URL(`../workers/execution-worker.${extension}`, import.meta.url)), [], {
      execArgv: extension === 'ts' ? ['--import', 'tsx'] : [],
      env: executionEnvironment(), detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    this.deadline = setTimeout(() => this.abort('Execution worker deadline exceeded'), job.timeoutMs + 65_000)
    this.worker.stderr?.resume()
    this.worker.on('message', raw => {
      if (this.settled) return
      const message = raw as WorkerMessage
      try {
        if (message.type === 'spawned') this.providerPid = message.pid
        else if (message.type === 'prepared') {
          if (this.cancelled || !canExecute()) this.cancel()
          else this.worker.send({ type: 'execute' })
        } else if (message.type === 'result') this.complete(message.result)
        else receive(message)
      } catch (error) { this.abort((error as Error).message) }
    })
    this.worker.once('error', error => this.abort(`Execution worker failed: ${error.message}`))
    this.worker.once('exit', () => {
      if (!this.settled) this.abort('Execution worker exited before returning a result')
    })
    this.worker.send({ type: 'start', job }, error => { if (error) this.abort(error.message) })
  }

  cancel(): void {
    if (this.settled || this.cancelled) return
    this.cancelled = true
    if (this.worker.connected) this.worker.send({ type: 'cancel' }, () => {})
    this.killTimer = setTimeout(() => this.abort('Execution cancellation exceeded grace period'), 6500)
  }

  private abort(error: string): void {
    if (this.settled) return
    // Both PIDs come exclusively from this fork and its IPC channel.
    for (const pid of [this.providerPid, this.worker.pid]) {
      if (!pid) continue
      try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL') } catch { /* already gone */ }
    }
    this.complete({ success: false, code: null, cancelled: this.cancelled, snapshotOK: false, error, output: '' })
  }

  private complete(result: ExecutionResult): void {
    if (this.settled) return
    this.settled = true
    clearTimeout(this.deadline)
    if (this.killTimer) clearTimeout(this.killTimer)
    if (this.cancelled) result = { ...result, success: false, cancelled: true, error: '用户取消执行' }
    this.finish(result)
  }
}
