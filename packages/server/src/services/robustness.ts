import { randomUUID } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type {
  RetryPolicy, DeadLetterItem, Checkpoint, AuditLogEntry,
  Run, TaskNodeStatus,
} from '../types/index.js'

/**
 * RobustnessService — 健壮性增强服务
 * 
 * 核心职责：
 * 1. 重试机制：失败任务按策略自动重试（指数退避/固定间隔）
 * 2. 死信队列：多次重试失败后进入死信队列，等待人工介入
 * 3. Checkpoint：定期保存 Run 快照，支持灾难恢复
 * 4. 审计日志：记录所有关键操作，支持事后审计和问题追踪
 * 
 * 设计原则：
 * - 失败是常态：网络抖动、CLI 超时、进程崩溃都应被优雅处理
 * - 可观测性：所有关键路径都有审计日志
 * - 可恢复性：任何时刻都能从 Checkpoint 恢复
 * - 不阻塞主流程：重试和 Checkpoint 均异步执行
 */
export class RobustnessService {
  private deadLetterQueue: DeadLetterItem[] = []
  private checkpoints: Map<string, Checkpoint[]> = new Map()  // runId → checkpoints
  private auditLog: AuditLogEntry[] = []
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private storagePath: string
  private maxAuditSize = 50000
  private maxCheckpointsPerRun = 20

  // 默认重试策略
  private defaultRetryPolicy: RetryPolicy = {
    maxRetries: 3,
    backoffType: 'exponential',
    baseDelayMs: 5000,
    maxDelayMs: 120_000,
  }

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'robustness')
  }

  // ═══════════════ 重试机制 ═══════════════

  /**
   * 调度重试
   * 
   * @param key 唯一标识（通常是 nodeId 或 turnId）
   * @param retryCount 当前已重试次数
   * @param policy 重试策略
   * @param action 重试时执行的操作
   * @returns 是否安排了重试（false = 已超过最大次数）
   */
  scheduleRetry(
    key: string,
    retryCount: number,
    action: () => Promise<void>,
    policy?: RetryPolicy
  ): boolean {
    const p = policy || this.defaultRetryPolicy

    if (retryCount >= p.maxRetries) {
      return false  // 超过最大重试次数
    }

    const delay = this.calculateDelay(retryCount, p)
    console.log(`[Robustness] Scheduling retry ${retryCount + 1}/${p.maxRetries} for ${key} in ${delay}ms`)

    // 清除之前的定时器（如果有）
    const existingTimer = this.retryTimers.get(key)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(async () => {
      this.retryTimers.delete(key)
      try {
        await action()
        this.audit('retry_succeeded', { key, attempt: retryCount + 1 })
      } catch (e) {
        this.audit('retry_failed', { key, attempt: retryCount + 1, error: (e as Error).message }, 'warn')
        // 递归调度下一次重试
        const shouldContinue = this.scheduleRetry(key, retryCount + 1, action, p)
        if (!shouldContinue) {
          console.warn(`[Robustness] Max retries exceeded for ${key}, moving to dead letter queue`)
        }
      }
    }, delay)

    this.retryTimers.set(key, timer)
    return true
  }

  /**
   * 取消待重试任务
   */
  cancelRetry(key: string): boolean {
    const timer = this.retryTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.retryTimers.delete(key)
      return true
    }
    return false
  }

  /**
   * 计算重试延迟
   */
  private calculateDelay(retryCount: number, policy: RetryPolicy): number {
    let delay: number
    switch (policy.backoffType) {
      case 'exponential':
        delay = policy.baseDelayMs * Math.pow(2, retryCount)
        break
      case 'fixed':
      default:
        delay = policy.baseDelayMs
        break
    }
    // 加入少量随机抖动（±10%）避免雷群效应
    const jitter = delay * 0.1 * (Math.random() * 2 - 1)
    return Math.min(delay + jitter, policy.maxDelayMs)
  }

  // ═══════════════ 死信队列 ═══════════════

  /**
   * 将失败任务加入死信队列
   */
  addToDeadLetter(params: {
    nodeId: string
    runId: string
    agentId: string
    retryCount: number
    lastError: string
    originalPrompt: string
  }): DeadLetterItem {
    const item: DeadLetterItem = {
      id: `dlq_${randomUUID().slice(0, 8)}`,
      ...params,
      failedAt: Date.now(),
    }
    this.deadLetterQueue.push(item)
    this.audit('dead_letter_enqueued', { itemId: item.id, nodeId: params.nodeId }, 'error')
    return item
  }

  /**
   * 获取死信队列
   */
  getDeadLetterQueue(runId?: string): DeadLetterItem[] {
    if (runId) return this.deadLetterQueue.filter(d => d.runId === runId)
    return [...this.deadLetterQueue]
  }

  /**
   * 从死信队列解决（人工介入后）
   */
  resolveDeadLetter(itemId: string, resolution: 'manual_retry' | 'skipped' | 'reassigned'): boolean {
    const item = this.deadLetterQueue.find(d => d.id === itemId)
    if (!item) return false

    item.resolution = resolution
    item.resolvedAt = Date.now()
    this.audit('dead_letter_resolved', { itemId, resolution })
    return true
  }

  /**
   * 清除已解决的死信项
   */
  purgeResolved(): number {
    const before = this.deadLetterQueue.length
    this.deadLetterQueue = this.deadLetterQueue.filter(d => !d.resolvedAt)
    return before - this.deadLetterQueue.length
  }

  // ═══════════════ Checkpoint（快照恢复） ═══════════════

  /**
   * 创建 Run 快照
   */
  createCheckpoint(run: Run, description?: string): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `ckpt_${randomUUID().slice(0, 8)}`,
      runId: run.id,
      snapshotAt: Date.now(),
      nodeStates: run.nodes.map(n => ({
        nodeId: n.id,
        status: n.status,
      })),
      description: description || `Checkpoint at ${new Date().toISOString()}`,
    }

    const runCheckpoints = this.checkpoints.get(run.id) || []
    runCheckpoints.push(checkpoint)

    // 限制每个 Run 的 checkpoint 数量
    if (runCheckpoints.length > this.maxCheckpointsPerRun) {
      runCheckpoints.splice(0, runCheckpoints.length - this.maxCheckpointsPerRun)
    }

    this.checkpoints.set(run.id, runCheckpoints)
    this.audit('checkpoint_created', { runId: run.id, checkpointId: checkpoint.id })
    return checkpoint
  }

  /**
   * 获取 Run 的所有 Checkpoint
   */
  getCheckpoints(runId: string): Checkpoint[] {
    return this.checkpoints.get(runId) || []
  }

  /**
   * 获取最近的 Checkpoint
   */
  getLatestCheckpoint(runId: string): Checkpoint | undefined {
    const all = this.checkpoints.get(runId) || []
    return all[all.length - 1]
  }

  /**
   * 恢复到指定 Checkpoint（返回应该设置的节点状态）
   * 注意：实际恢复需要调用方配合 WorkflowEngine 执行
   */
  getCheckpointStates(checkpointId: string): Array<{ nodeId: string; status: TaskNodeStatus }> | undefined {
    for (const checkpoints of this.checkpoints.values()) {
      const found = checkpoints.find(c => c.id === checkpointId)
      if (found) return found.nodeStates
    }
    return undefined
  }

  // ═══════════════ 审计日志 ═══════════════

  /**
   * 记录审计日志
   */
  audit(
    action: string,
    details: Record<string, unknown>,
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const entry: AuditLogEntry = {
      id: `log_${randomUUID().slice(0, 8)}`,
      runId: (details.runId as string) || '',
      nodeId: details.nodeId as string | undefined,
      agentId: details.agentId as string | undefined,
      action,
      details,
      timestamp: Date.now(),
      level,
    }

    this.auditLog.push(entry)

    // 控制大小
    if (this.auditLog.length > this.maxAuditSize) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.maxAuditSize * 0.8))
    }

    // 错误级别同时 console 输出
    if (level === 'error') {
      console.error(`[Audit] ${action}:`, details)
    }
  }

  /**
   * 查询审计日志
   */
  queryAuditLog(filters?: {
    runId?: string
    nodeId?: string
    agentId?: string
    action?: string
    level?: 'info' | 'warn' | 'error'
    since?: number
    limit?: number
  }): AuditLogEntry[] {
    let log = this.auditLog

    if (filters?.runId) log = log.filter(e => e.runId === filters.runId)
    if (filters?.nodeId) log = log.filter(e => e.nodeId === filters.nodeId)
    if (filters?.agentId) log = log.filter(e => e.agentId === filters.agentId)
    if (filters?.action) log = log.filter(e => e.action.includes(filters.action!))
    if (filters?.level) log = log.filter(e => e.level === filters.level)
    if (filters?.since) log = log.filter(e => e.timestamp >= filters.since!)

    return log.slice(-(filters?.limit || 200))
  }

  /**
   * 导出审计日志到文件
   */
  async exportAuditLog(runId?: string): Promise<string> {
    const log = runId ? this.auditLog.filter(e => e.runId === runId) : this.auditLog
    const exportPath = join(this.storagePath, `audit_${Date.now()}.json`)
    await mkdir(this.storagePath, { recursive: true })
    await writeFile(exportPath, JSON.stringify(log, null, 2), 'utf-8')
    return exportPath
  }

  // ═══════════════ 健康检查 ═══════════════

  /**
   * 获取系统健康状态
   */
  getHealthStatus(): {
    deadLetterCount: number
    pendingRetries: number
    totalCheckpoints: number
    auditLogSize: number
    status: 'healthy' | 'degraded' | 'critical'
  } {
    const deadLetterCount = this.deadLetterQueue.filter(d => !d.resolvedAt).length
    const pendingRetries = this.retryTimers.size
    let totalCheckpoints = 0
    for (const cps of this.checkpoints.values()) {
      totalCheckpoints += cps.length
    }

    let status: 'healthy' | 'degraded' | 'critical' = 'healthy'
    if (deadLetterCount > 5) status = 'degraded'
    if (deadLetterCount > 20) status = 'critical'

    return {
      deadLetterCount,
      pendingRetries,
      totalCheckpoints,
      auditLogSize: this.auditLog.length,
      status,
    }
  }

  /**
   * 清理 Run 相关数据
   */
  cleanupRun(runId: string): void {
    this.checkpoints.delete(runId)
    this.deadLetterQueue = this.deadLetterQueue.filter(d => d.runId !== runId)
    // 审计日志保留（可按需清理）
  }

  /**
   * 停止所有重试定时器
   */
  dispose(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer)
    }
    this.retryTimers.clear()
  }
}
