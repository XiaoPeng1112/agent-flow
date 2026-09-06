import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ExecutionWorkerClient } from '../src/services/execution-worker-client.js'
import { executionEnvironment } from '../src/services/execution-environment.js'
import type { ExecutionJob, WorkerMessage } from '../src/workers/protocol.js'

// Every child and process group in these tests is created in a disposable directory.
describe('Execution worker lifecycle', () => {
  let root: string
  const workers: ExecutionWorkerClient[] = []
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'agentflow-worker-')) })
  afterEach(async () => {
    for (const worker of workers.splice(0)) { worker.cancel(); await worker.result }
    rmSync(root, { recursive: true, force: true })
  })
  const start = (script: string, options: Partial<ExecutionJob> = {}, canExecute = () => true, receive = (_: WorkerMessage) => {}) => {
    const worker = new ExecutionWorkerClient({ turnId: 'turn', prompt: '', cwd: root, script,
      environment: executionEnvironment(), timeoutMs: 5000, killGraceMs: 100, ...options }, receive, canExecute)
    workers.push(worker)
    return worker
  }
  function script(): string {
    writeFileSync(join(root, 'child.cjs'), `const fs=require('fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync('child.pid',String(process.pid));
setTimeout(()=>fs.writeFileSync('late-write','unsafe'),2500);
setInterval(()=>{},100);
`)
    writeFileSync(join(root, 'leader.cjs'), `const cp=require('child_process');
cp.spawn(process.execPath,['child.cjs'],{stdio:'ignore'});
require('fs').writeFileSync('leader.pid',String(process.pid));
setInterval(()=>{},100);
`)
    return `exec node leader.cjs`
  }
  it('starts a separate worker without blocking the main event loop', async () => {
    let ticks = 0
    const interval = setInterval(() => ticks++, 10)
    const worker = start('sleep 0.2; echo complete')
    expect(worker.worker.pid).not.toBe(process.pid)
    try {
      expect((await worker.result).success).toBe(true)
      expect(ticks).toBeGreaterThan(3)
    } finally { clearInterval(interval) }
  })
  it('cancels before authorization without launching the executable', async () => {
    const worker = start('echo unsafe > launched', {}, () => false)
    expect((await worker.result).cancelled).toBe(true)
    expect(existsSync(join(root, 'launched'))).toBe(false)
  })
  it('kills a stubborn descendant even after its leader exits on cancellation', async () => {
    const worker = start(script())
    await vi.waitFor(() => expect(existsSync(join(root, 'child.pid'))).toBe(true), { timeout: 5000 })
    worker.cancel()
    expect((await worker.result).cancelled).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 2600))
    expect(existsSync(join(root, 'late-write'))).toBe(false)
  }, 10_000)
  it('times out without leaving a child that can write after the result', async () => {
    const worker = start(script(), { timeoutMs: 300 })
    const result = await worker.result
    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    expect(result.allowFallback).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 2600))
    expect(existsSync(join(root, 'late-write'))).toBe(false)
  }, 10_000)
  it('stops its process group when the parent IPC connection disappears', async () => {
    const worker = start(script())
    await vi.waitFor(() => expect(existsSync(join(root, 'child.pid'))).toBe(true), { timeout: 5000 })
    worker.worker.disconnect()
    expect((await worker.result).success).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 2600))
    expect(existsSync(join(root, 'late-write'))).toBe(false)
  }, 10_000)
  it('returns spawn failure once and never reports a successful completion', async () => {
    const worker = start('', { agent: { id: 'missing', name: 'Missing', role: 'executor', type: 'custom-cli', command: join(root, 'missing') } })
    const result = await worker.result
    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOENT')
  })
  it('streams stdout and stderr without mixing diagnostics into the result', async () => {
    const output: string[] = []
    const worker = start('echo result; echo diagnostic >&2', {}, () => true, message => {
      if (message.type === 'output') output.push(message.text)
    })
    const result = await worker.result
    expect(result.output).toBe('result\n')
    expect(output.join('')).toContain('diagnostic')
    // The workspace is test-local and no files were created by this read-only script.
    expect(existsSync(join(root, 'launched'))).toBe(false)
  })
  it('retains completed writes in the work directory', async () => {
    expect((await start('echo retained > artifact').result).success).toBe(true)
    expect(readFileSync(join(root, 'artifact'), 'utf8')).toBe('retained\n')
  })
})
