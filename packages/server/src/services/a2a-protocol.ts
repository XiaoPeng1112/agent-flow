import { randomUUID } from 'crypto'
import type {
  A2AMessage, A2AMessageType, A2AChannel,
  DelegatedTask, TaskDelivery,
} from '../types/index.js'
import type { WorkflowEngine } from './workflow-engine.js'

type A2AEventHandler = (event: A2AEvent) => void

export interface A2AEvent {
  type: 'message_queued' | 'message_delivered' | 'message_resolved' | 'message_expired' | 'channel_created'
  message?: A2AMessage
  channel?: A2AChannel
}

/**
 * A2AProtocolService — Agent-to-Agent 通信协议服务
 * 
 * 核心职责：
 * 1. 消息路由：Agent 间发送/接收结构化消息
 * 2. 消息确认机制：支持 ACK 确认，确保消息可靠送达
 * 3. 消息过期：超时未处理的消息自动过期
 * 4. 通信通道：维护 Agent 间的逻辑通信链路
 * 5. 与 WorkflowEngine.Inbox 整合：桥接旧 Inbox 和新 A2A 协议
 * 
 * 协议特性：
 * - 支持优先级队列（critical > high > normal > low）
 * - 支持重试机制（自动重发未确认消息）
 * - 支持广播（一对多通信）
 * - 事件驱动（消息状态变更触发回调）
 * 
 * 使用场景：
 * - Manager Agent 委派任务给 Executor Agent
 * - Executor 完成后向 Manager 汇报结果
 * - Agent 间协调资源分配（如仓库访问权限请求）
 * - 进度汇报与状态同步
 */
export class A2AProtocolService {
  private messages: Map<string, A2AMessage> = new Map()
  private channels: Map<string, A2AChannel> = new Map()
  private agentInbox: Map<string, string[]> = new Map()  // agentId → messageIds
  private eventHandlers: Set<A2AEventHandler> = new Set()
  private workflowEngine: WorkflowEngine
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(workflowEngine: WorkflowEngine) {
    this.workflowEngine = workflowEngine
    // 启动过期消息清理定时器（每分钟检查）
    this.cleanupInterval = setInterval(() => this.cleanupExpiredMessages(), 60_000)
  }

  /**
   * 停止服务（清理定时器）
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  // ═══════════════ 事件系统 ═══════════════

  onEvent(handler: A2AEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  private emit(event: A2AEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event)
      } catch (e) {
        console.error('[A2A] Event handler error:', (e as Error).message)
      }
    }
  }

  // ═══════════════ 消息发送 ═══════════════

  /**
   * 发送 A2A 消息
   * 
   * @returns 消息 ID
   */
  send(params: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    type: A2AMessageType
    payload: unknown
    priority?: 'low' | 'normal' | 'high' | 'critical'
    requiresAck?: boolean
    ttlMs?: number           // 消息存活时间（毫秒）
  }): A2AMessage {
    const now = Date.now()
    const {
      fromAgentId, toAgentId, runId, nodeId, type,
      payload, priority = 'normal', requiresAck = false,
      ttlMs = 30 * 60 * 1000,  // 默认 30 分钟
    } = params

    const message: A2AMessage = {
      id: `a2a_${randomUUID().slice(0, 8)}`,
      fromAgentId,
      toAgentId,
      runId,
      nodeId,
      type,
      payload,
      priority,
      status: 'queued',
      requiresAck,
      createdAt: now,
      expiresAt: now + ttlMs,
      retryCount: 0,
      maxRetries: 3,
    }

    this.messages.set(message.id, message)

    // 加入目标 Agent 的收件箱
    const inbox = this.agentInbox.get(toAgentId) || []
    inbox.push(message.id)
    this.agentInbox.set(toAgentId, inbox)

    // 同时桥接到 WorkflowEngine 的旧 Inbox 系统（兼容性）
    this.bridgeToLegacyInbox(message)

    this.emit({ type: 'message_queued', message })
    return message
  }

  /**
   * 发送委派任务消息
   */
  delegateTask(params: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    task: DelegatedTask
    priority?: 'normal' | 'high' | 'critical'
  }): A2AMessage {
    return this.send({
      ...params,
      type: 'delegated_task',
      payload: params.task,
      requiresAck: true,
    })
  }

  /**
   * 发送任务交付消息
   */
  deliverTask(params: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    delivery: TaskDelivery
  }): A2AMessage {
    return this.send({
      ...params,
      type: 'task_delivery',
      payload: params.delivery,
      requiresAck: true,
    })
  }

  /**
   * 发送进度汇报
   */
  reportProgress(params: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    progress: { percentage: number; message: string; details?: unknown }
  }): A2AMessage {
    return this.send({
      ...params,
      type: 'progress_report',
      payload: params.progress,
      requiresAck: false,
      priority: 'low',
    })
  }

  /**
   * 广播消息给通道内所有 Agent
   */
  broadcast(channelId: string, params: {
    fromAgentId: string
    runId: string
    nodeId: string
    type: A2AMessageType
    payload: unknown
  }): A2AMessage[] {
    const channel = this.channels.get(channelId)
    if (!channel) throw new Error(`Channel not found: ${channelId}`)

    const messages: A2AMessage[] = []
    for (const agentId of channel.participants) {
      if (agentId !== params.fromAgentId) {
        const msg = this.send({ ...params, toAgentId: agentId })
        messages.push(msg)
      }
    }
    return messages
  }

  // ═══════════════ 消息接收与处理 ═══════════════

  /**
   * 获取 Agent 的消息队列（按优先级排序）
   */
  getInbox(agentId: string, filters?: {
    status?: A2AMessage['status']
    type?: A2AMessageType
    runId?: string
  }): A2AMessage[] {
    const messageIds = this.agentInbox.get(agentId) || []
    let messages = messageIds
      .map(id => this.messages.get(id))
      .filter((m): m is A2AMessage => m !== undefined)

    if (filters?.status) messages = messages.filter(m => m.status === filters.status)
    if (filters?.type) messages = messages.filter(m => m.type === filters.type)
    if (filters?.runId) messages = messages.filter(m => m.runId === filters.runId)

    // 按优先级排序
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 }
    return messages.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }

  /**
   * 拉取下一条待处理消息（FIFO + 优先级）
   */
  pullNext(agentId: string): A2AMessage | undefined {
    const inbox = this.getInbox(agentId, { status: 'queued' })
    if (inbox.length === 0) return undefined

    const message = inbox[0]
    message.status = 'delivered'
    message.deliveredAt = Date.now()
    this.emit({ type: 'message_delivered', message })
    return message
  }

  /**
   * 确认消息已接收处理
   */
  acknowledge(messageId: string): boolean {
    const message = this.messages.get(messageId)
    if (!message) return false

    message.ackAt = Date.now()
    message.status = 'processing'
    return true
  }

  /**
   * 标记消息已解决
   */
  resolve(messageId: string, result?: unknown): boolean {
    const message = this.messages.get(messageId)
    if (!message) return false

    message.status = 'resolved'
    message.resolvedAt = Date.now()
    if (result) {
      (message.payload as Record<string, unknown>).__resolution = result
    }

    this.emit({ type: 'message_resolved', message })
    return true
  }

  /**
   * 标记消息处理失败
   */
  fail(messageId: string, _reason?: string): boolean {
    const message = this.messages.get(messageId)
    if (!message) return false

    message.retryCount++
    if (message.retryCount >= message.maxRetries) {
      message.status = 'failed'
    } else {
      // 可以重试，重新入队
      message.status = 'queued'
    }
    return true
  }

  // ═══════════════ 通信通道 ═══════════════

  /**
   * 创建通信通道
   */
  createChannel(runId: string, participants: string[]): A2AChannel {
    const channel: A2AChannel = {
      id: `ch_${randomUUID().slice(0, 8)}`,
      runId,
      participants,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    }
    this.channels.set(channel.id, channel)
    this.emit({ type: 'channel_created', channel })
    return channel
  }

  /**
   * 获取 Run 的所有通道
   */
  getChannels(runId: string): A2AChannel[] {
    return Array.from(this.channels.values()).filter(c => c.runId === runId)
  }

  /**
   * 获取 Agent 参与的所有通道
   */
  getAgentChannels(agentId: string): A2AChannel[] {
    return Array.from(this.channels.values()).filter(
      c => c.participants.includes(agentId)
    )
  }

  // ═══════════════ 统计与查询 ═══════════════

  /**
   * 获取消息统计
   */
  getStats(runId?: string): {
    total: number
    queued: number
    processing: number
    resolved: number
    failed: number
    expired: number
  } {
    let messages = Array.from(this.messages.values())
    if (runId) messages = messages.filter(m => m.runId === runId)

    return {
      total: messages.length,
      queued: messages.filter(m => m.status === 'queued').length,
      processing: messages.filter(m => m.status === 'processing').length,
      resolved: messages.filter(m => m.status === 'resolved').length,
      failed: messages.filter(m => m.status === 'failed').length,
      expired: messages.filter(m => m.status === 'expired').length,
    }
  }

  /**
   * 获取特定消息
   */
  getMessage(messageId: string): A2AMessage | undefined {
    return this.messages.get(messageId)
  }

  /**
   * 获取 Run 的所有消息
   */
  getRunMessages(runId: string): A2AMessage[] {
    return Array.from(this.messages.values())
      .filter(m => m.runId === runId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  // ═══════════════ 生命周期管理 ═══════════════

  /**
   * 清理过期消息
   */
  private cleanupExpiredMessages(): void {
    const now = Date.now()
    for (const [, message] of this.messages) {
      if (message.expiresAt && message.expiresAt < now && message.status === 'queued') {
        message.status = 'expired'
        this.emit({ type: 'message_expired', message })
      }
    }
  }

  /**
   * 清理 Run 相关的所有消息和通道
   */
  cleanupRun(runId: string): void {
    // 清理消息
    for (const [msgId, message] of this.messages) {
      if (message.runId === runId) {
        this.messages.delete(msgId)
      }
    }

    // 清理通道
    for (const [chId, channel] of this.channels) {
      if (channel.runId === runId) {
        this.channels.delete(chId)
      }
    }

    // 清理收件箱中的引用
    for (const [agentId, messageIds] of this.agentInbox) {
      const filtered = messageIds.filter(id => this.messages.has(id))
      if (filtered.length !== messageIds.length) {
        this.agentInbox.set(agentId, filtered)
      }
    }
  }

  // ═══════════════ 旧 Inbox 桥接 ═══════════════

  /**
   * 将 A2A 消息桥接到 WorkflowEngine 的旧 Inbox 系统
   * 确保向后兼容性
   */
  private bridgeToLegacyInbox(message: A2AMessage): void {
    // 仅桥接 delegated_task 和 task_delivery 类型
    if (message.type === 'delegated_task' || message.type === 'task_delivery' || message.type === 'user_input') {
      this.workflowEngine.enqueueInbox({
        agentId: message.toAgentId,
        nodeId: message.nodeId,
        runId: message.runId,
        type: message.type as 'delegated_task' | 'task_delivery' | 'user_input',
        payload: message.payload as any,
      })
    }
  }
}
