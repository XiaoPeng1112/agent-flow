import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button, Tag, Empty, Badge, Segmented, Descriptions } from 'antd'
import {
  ReloadOutlined, SendOutlined, MessageOutlined, NodeIndexOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  ThunderboltOutlined, WarningOutlined, LoadingOutlined,
  SwapOutlined, TeamOutlined, BarChartOutlined,
} from '@ant-design/icons'
import { a2aApi } from '../../api'
import type { Run, A2AMessage, A2AStats } from '../../types'

/**
 * A2APanel — Agent-to-Agent 通信可视化面板
 * 
 * 功能：
 * 1. 消息拓扑图：展示 Agent 间的消息流转关系
 * 2. 消息时间线：按时间顺序展示所有消息
 * 3. 统计概览：消息状态分布、优先级分布
 * 4. 通道管理：查看活跃通信通道
 */

interface Props {
  run: Run
}

type ViewMode = 'topology' | 'timeline' | 'stats'

// 消息类型配置
const messageTypeConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  delegated_task: { label: '委派任务', color: 'purple', icon: <SendOutlined /> },
  task_delivery: { label: '任务交付', color: 'green', icon: <CheckCircleOutlined /> },
  user_input: { label: '用户输入', color: 'blue', icon: <MessageOutlined /> },
  progress_report: { label: '进度汇报', color: 'cyan', icon: <BarChartOutlined /> },
  resource_request: { label: '资源请求', color: 'orange', icon: <ThunderboltOutlined /> },
}

// 消息状态配置
const messageStatusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  queued: { label: '排队中', color: 'default', icon: <ClockCircleOutlined /> },
  delivered: { label: '已送达', color: 'processing', icon: <SendOutlined /> },
  processing: { label: '处理中', color: 'warning', icon: <LoadingOutlined spin /> },
  resolved: { label: '已解决', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { label: '失败', color: 'error', icon: <CloseCircleOutlined /> },
  expired: { label: '已过期', color: 'default', icon: <WarningOutlined /> },
}

// 优先级配置
const priorityConfig: Record<string, { label: string; color: string }> = {
  critical: { label: '紧急', color: '#ef4444' },
  high: { label: '高', color: '#f59e0b' },
  normal: { label: '普通', color: '#6b7280' },
  low: { label: '低', color: '#9ca3af' },
}

export function A2APanel({ run }: Props) {
  const [messages, setMessages] = useState<A2AMessage[]>([])
  const [stats, setStats] = useState<A2AStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('topology')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [msgRes, statsRes] = await Promise.all([
        a2aApi.getMessages(run.id),
        a2aApi.getStats(run.id),
      ])
      setMessages(msgRes.messages || [])
      setStats(statsRes)
    } catch (err: any) {
      // 静默失败——后端可能没有消息数据
      setMessages([])
      setStats({ total: 0, queued: 0, processing: 0, resolved: 0, failed: 0, expired: 0 })
    } finally {
      setLoading(false)
    }
  }, [run.id])

  useEffect(() => {
    fetchData()
    // 每 10 秒自动刷新
    const timer = setInterval(fetchData, 10000)
    return () => clearInterval(timer)
  }, [fetchData])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <SwapOutlined className="text-indigo-500" />
          <span className="text-[14px] font-semibold text-gray-800">A2A 消息</span>
          <Badge count={messages.length} showZero color="#6366f1" className="ml-1" />
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            size="small"
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            options={[
              { value: 'topology', label: '拓扑图', icon: <NodeIndexOutlined /> },
              { value: 'timeline', label: '时间线', icon: <MessageOutlined /> },
              { value: 'stats', label: '统计', icon: <BarChartOutlined /> },
            ]}
          />
          <Button
            size="small"
            icon={<ReloadOutlined spin={loading} />}
            onClick={fetchData}
          >
            刷新
          </Button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div className="text-center">
                  <p className="text-gray-400 text-[13px]">暂无 Agent 间通信消息</p>
                  <p className="text-gray-300 text-[11px] mt-1">
                    当 Agent 执行任务时，它们之间的委派、交付和汇报消息将显示在这里
                  </p>
                </div>
              }
            />
          </div>
        ) : viewMode === 'topology' ? (
          <TopologyView messages={messages} run={run} />
        ) : viewMode === 'timeline' ? (
          <TimelineView messages={messages} run={run} />
        ) : (
          <StatsView messages={messages} stats={stats} />
        )}
      </div>
    </div>
  )
}

// ═══════════════ 拓扑图视图 ═══════════════

function TopologyView({ messages }: { messages: A2AMessage[]; run: Run }) {
  // 构建 Agent 间的通信关系图
  const { agentNodes, connections } = useMemo(() => {
    const agentSet = new Set<string>()
    const connMap = new Map<string, { count: number; types: Set<string>; priorities: Set<string> }>()

    for (const msg of messages) {
      agentSet.add(msg.fromAgentId)
      agentSet.add(msg.toAgentId)

      const key = `${msg.fromAgentId}→${msg.toAgentId}`
      const existing = connMap.get(key) || { count: 0, types: new Set(), priorities: new Set() }
      existing.count++
      existing.types.add(msg.type)
      existing.priorities.add(msg.priority)
      connMap.set(key, existing)
    }

    // 为每个 Agent 计算统计
    const agentNodes = Array.from(agentSet).map((agentId) => {
      const sent = messages.filter((m) => m.fromAgentId === agentId).length
      const received = messages.filter((m) => m.toAgentId === agentId).length
      // 推断角色
      const sentTypes = messages.filter((m) => m.fromAgentId === agentId).map((m) => m.type)
      const isManager = sentTypes.includes('delegated_task')
      const isExecutor = sentTypes.includes('task_delivery')
      const role = isManager ? 'manager' : isExecutor ? 'executor' : 'planner'
      return { id: agentId, sent, received, role }
    })

    const connections = Array.from(connMap.entries()).map(([key, value]) => {
      const [from, to] = key.split('→')
      return { from, to, ...value, types: Array.from(value.types), priorities: Array.from(value.priorities) }
    })

    return { agentNodes, connections }
  }, [messages])

  if (agentNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通信拓扑数据" />
      </div>
    )
  }

  // 简单的环形布局
  const centerX = 300
  const centerY = 200
  const radius = 140
  const angleStep = (2 * Math.PI) / Math.max(agentNodes.length, 1)

  const roleColors: Record<string, string> = {
    planner: '#8b5cf6',
    manager: '#3b82f6',
    executor: '#10b981',
  }

  return (
    <div className="p-4">
      {/* Agent 节点统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {agentNodes.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 bg-white hover:shadow-sm transition-shadow"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[12px] font-bold shrink-0"
              style={{ backgroundColor: roleColors[agent.role] || '#6b7280' }}
            >
              {agent.id.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-gray-700 truncate">{agent.id}</div>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                <span className="text-indigo-500">↑{agent.sent}</span>
                <span className="text-green-500">↓{agent.received}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* SVG 拓扑图 */}
      <div className="bg-gray-50/50 rounded-xl border border-gray-100 overflow-hidden">
        <svg viewBox="0 0 600 400" className="w-full h-[320px]">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#6366f1" opacity="0.7" />
            </marker>
            <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
            </marker>
          </defs>

          {/* 连接线 */}
          {connections.map((conn, idx) => {
            const fromIdx = agentNodes.findIndex((a) => a.id === conn.from)
            const toIdx = agentNodes.findIndex((a) => a.id === conn.to)
            if (fromIdx === -1 || toIdx === -1) return null

            const fromX = centerX + radius * Math.cos(fromIdx * angleStep - Math.PI / 2)
            const fromY = centerY + radius * Math.sin(fromIdx * angleStep - Math.PI / 2)
            const toX = centerX + radius * Math.cos(toIdx * angleStep - Math.PI / 2)
            const toY = centerY + radius * Math.sin(toIdx * angleStep - Math.PI / 2)

            // 曲线中点
            const midX = (fromX + toX) / 2 + (fromY - toY) * 0.15
            const midY = (fromY + toY) / 2 + (toX - fromX) * 0.15

            const isActive = conn.priorities.includes('high') || conn.priorities.includes('critical')
            const strokeWidth = Math.min(1 + conn.count * 0.5, 4)

            return (
              <g key={idx}>
                <path
                  d={`M ${fromX} ${fromY} Q ${midX} ${midY} ${toX} ${toY}`}
                  fill="none"
                  stroke={isActive ? '#f59e0b' : '#6366f1'}
                  strokeWidth={strokeWidth}
                  opacity={0.6}
                  markerEnd={isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                  strokeDasharray={conn.types.includes('progress_report') ? '4 2' : 'none'}
                />
                {/* 消息数量标签 */}
                <text
                  x={midX}
                  y={midY - 8}
                  textAnchor="middle"
                  className="text-[9px] fill-gray-400"
                >
                  ×{conn.count}
                </text>
              </g>
            )
          })}

          {/* Agent 节点 */}
          {agentNodes.map((agent, idx) => {
            const x = centerX + radius * Math.cos(idx * angleStep - Math.PI / 2)
            const y = centerY + radius * Math.sin(idx * angleStep - Math.PI / 2)
            const color = roleColors[agent.role] || '#6b7280'

            return (
              <g key={agent.id}>
                {/* 外圈光晕 */}
                <circle cx={x} cy={y} r={32} fill={color} opacity={0.08} />
                {/* 主圆 */}
                <circle cx={x} cy={y} r={24} fill="white" stroke={color} strokeWidth={2.5} />
                {/* Agent 简称 */}
                <text x={x} y={y - 4} textAnchor="middle" fill={color} className="text-[10px] font-bold">
                  {agent.id.split('-').pop()?.slice(0, 4) || agent.id.slice(0, 4)}
                </text>
                {/* 角色标签 */}
                <text x={x} y={y + 8} textAnchor="middle" fill="#9ca3af" className="text-[8px]">
                  {agent.role}
                </text>
                {/* Agent 名称 */}
                <text x={x} y={y + 42} textAnchor="middle" fill="#4b5563" className="text-[9px]">
                  {agent.id.length > 16 ? agent.id.slice(0, 14) + '…' : agent.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* 连接关系表格 */}
      {connections.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[12px] font-medium text-gray-600 mb-2 flex items-center gap-1.5">
            <NodeIndexOutlined className="text-indigo-400" />
            通信链路 ({connections.length})
          </h4>
          <div className="space-y-1.5">
            {connections.map((conn, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-50 hover:border-indigo-100 transition-colors">
                <span className="text-[11px] font-medium text-gray-700 min-w-[80px] truncate">{conn.from}</span>
                <span className="text-indigo-400 text-[11px]">→</span>
                <span className="text-[11px] font-medium text-gray-700 min-w-[80px] truncate">{conn.to}</span>
                <span className="text-[10px] text-gray-400 ml-auto">{conn.count} 条消息</span>
                <div className="flex gap-1">
                  {conn.types.map((type) => {
                    const cfg = messageTypeConfig[type]
                    return cfg ? (
                      <Tag key={type} color={cfg.color} className="!text-[9px] !px-1 !py-0 !m-0 !leading-3.5">
                        {cfg.label}
                      </Tag>
                    ) : null
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════ 时间线视图 ═══════════════

function TimelineView({ messages, run }: { messages: A2AMessage[]; run: Run }) {
  const [filter, setFilter] = useState<string>('all')

  const filteredMessages = useMemo(() => {
    let filtered = [...messages].sort((a, b) => b.createdAt - a.createdAt)
    if (filter !== 'all') {
      filtered = filtered.filter((m) => m.type === filter)
    }
    return filtered
  }, [messages, filter])

  return (
    <div className="p-4">
      {/* 过滤器 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
            filter === 'all' ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
          }`}
          onClick={() => setFilter('all')}
        >
          全部 ({messages.length})
        </button>
        {Object.entries(messageTypeConfig).map(([type, cfg]) => {
          const count = messages.filter((m) => m.type === type).length
          if (count === 0) return null
          return (
            <button
              key={type}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors flex items-center gap-1 ${
                filter === type ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => setFilter(type)}
            >
              {cfg.icon}
              {cfg.label} ({count})
            </button>
          )
        })}
      </div>

      {/* 消息列表 */}
      <div className="space-y-2">
        {filteredMessages.map((msg) => (
          <MessageCard key={msg.id} message={msg} run={run} />
        ))}
      </div>

      {filteredMessages.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配消息" className="mt-12" />
      )}
    </div>
  )
}

// 单条消息卡片
function MessageCard({ message: msg, run }: { message: A2AMessage; run: Run }) {
  const [expanded, setExpanded] = useState(false)
  const typeCfg = messageTypeConfig[msg.type] || { label: msg.type, color: 'default', icon: <MessageOutlined /> }
  const statusCfg = messageStatusConfig[msg.status] || { label: msg.status, color: 'default', icon: <ClockCircleOutlined /> }
  const priCfg = priorityConfig[msg.priority] || { label: msg.priority, color: '#6b7280' }

  // 找到关联的节点名称
  const nodeName = run.nodes.find((n) => n.id === msg.nodeId)?.name || msg.nodeId

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
  }

  const formatDuration = (start: number, end?: number) => {
    if (!end) return null
    const ms = end - start
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  }

  return (
    <div
      className={`group relative border rounded-lg overflow-hidden transition-all cursor-pointer ${
        expanded ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* 左侧优先级色条 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: priCfg.color }}
      />

      <div className="pl-4 pr-3 py-2.5">
        {/* 主体行 */}
        <div className="flex items-center gap-2">
          {/* 类型图标 */}
          <div className="text-[13px] text-gray-400">{typeCfg.icon}</div>

          {/* 路由信息 */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[11px] font-medium text-gray-700 truncate max-w-[100px]">
              {msg.fromAgentId.split('-').pop() || msg.fromAgentId}
            </span>
            <span className="text-indigo-400 text-[10px]">→</span>
            <span className="text-[11px] font-medium text-gray-700 truncate max-w-[100px]">
              {msg.toAgentId.split('-').pop() || msg.toAgentId}
            </span>
          </div>

          {/* 标签 */}
          <Tag color={typeCfg.color} className="!text-[9px] !px-1.5 !py-0 !m-0 !leading-3.5">
            {typeCfg.label}
          </Tag>
          <Tag color={statusCfg.color} className="!text-[9px] !px-1.5 !py-0 !m-0 !leading-3.5">
            {statusCfg.label}
          </Tag>

          {/* 时间 */}
          <span className="text-[10px] text-gray-400 shrink-0">{formatTime(msg.createdAt)}</span>
        </div>

        {/* 关联节点 */}
        <div className="flex items-center gap-2 mt-1 ml-6">
          <span className="text-[10px] text-gray-400">节点: {nodeName}</span>
          {msg.requiresAck && (
            <Tag color="gold" className="!text-[9px] !px-1 !py-0 !m-0 !leading-3.5">需确认</Tag>
          )}
          {msg.retryCount > 0 && (
            <span className="text-[9px] text-orange-500">重试 {msg.retryCount}/{msg.maxRetries}</span>
          )}
          {formatDuration(msg.createdAt, msg.resolvedAt) && (
            <span className="text-[9px] text-green-500 ml-auto">
              耗时 {formatDuration(msg.createdAt, msg.resolvedAt)}
            </span>
          )}
        </div>

        {/* 展开详情 */}
        {expanded && (
          <div className="mt-3 pt-2.5 border-t border-gray-100/80 space-y-2">
            <Descriptions size="small" column={2} className="!text-[11px]">
              <Descriptions.Item label="消息 ID">{msg.id}</Descriptions.Item>
              <Descriptions.Item label="优先级">
                <span style={{ color: priCfg.color }}>{priCfg.label}</span>
              </Descriptions.Item>
              <Descriptions.Item label="发送方">{msg.fromAgentId}</Descriptions.Item>
              <Descriptions.Item label="接收方">{msg.toAgentId}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{new Date(msg.createdAt).toLocaleString()}</Descriptions.Item>
              {msg.deliveredAt && (
                <Descriptions.Item label="送达时间">{new Date(msg.deliveredAt).toLocaleString()}</Descriptions.Item>
              )}
              {msg.resolvedAt && (
                <Descriptions.Item label="解决时间">{new Date(msg.resolvedAt).toLocaleString()}</Descriptions.Item>
              )}
              {msg.expiresAt && (
                <Descriptions.Item label="过期时间">{new Date(msg.expiresAt).toLocaleString()}</Descriptions.Item>
              )}
            </Descriptions>

            {/* Payload 展示 */}
            {msg.payload != null && (
              <div>
                <span className="text-[10px] text-gray-500 font-medium">Payload:</span>
                <pre className="mt-1 px-3 py-2 bg-gray-50 rounded-md text-[10px] text-gray-600 overflow-x-auto max-h-[150px] overflow-y-auto">
                  {JSON.stringify(msg.payload as object, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════ 统计视图 ═══════════════

function StatsView({ messages, stats }: { messages: A2AMessage[]; stats: A2AStats | null }) {
  // 按类型分组统计
  const typeStats = useMemo(() => {
    const map = new Map<string, number>()
    for (const msg of messages) {
      map.set(msg.type, (map.get(msg.type) || 0) + 1)
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [messages])

  // 按 Agent 分组统计
  const agentStats = useMemo(() => {
    const map = new Map<string, { sent: number; received: number }>()
    for (const msg of messages) {
      const from = map.get(msg.fromAgentId) || { sent: 0, received: 0 }
      from.sent++
      map.set(msg.fromAgentId, from)

      const to = map.get(msg.toAgentId) || { sent: 0, received: 0 }
      to.received++
      map.set(msg.toAgentId, to)
    }
    return Array.from(map.entries())
      .map(([id, data]) => ({ id, ...data, total: data.sent + data.received }))
      .sort((a, b) => b.total - a.total)
  }, [messages])

  // 平均响应时间
  const avgResponseTime = useMemo(() => {
    const resolved = messages.filter((m) => m.resolvedAt && m.createdAt)
    if (resolved.length === 0) return null
    const total = resolved.reduce((sum, m) => sum + (m.resolvedAt! - m.createdAt), 0)
    return total / resolved.length
  }, [messages])

  // 按优先级分组
  const priorityStats = useMemo(() => {
    const map = new Map<string, number>()
    for (const msg of messages) {
      map.set(msg.priority, (map.get(msg.priority) || 0) + 1)
    }
    return map
  }, [messages])

  return (
    <div className="p-4 space-y-5">
      {/* 概览指标 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="总消息" value={stats?.total || 0} icon={<MessageOutlined />} color="#6366f1" />
        <StatCard label="处理中" value={stats?.processing || 0} icon={<LoadingOutlined />} color="#f59e0b" />
        <StatCard label="已解决" value={stats?.resolved || 0} icon={<CheckCircleOutlined />} color="#10b981" />
        <StatCard label="失败" value={stats?.failed || 0} icon={<CloseCircleOutlined />} color="#ef4444" />
      </div>

      {/* 平均响应时间 */}
      {avgResponseTime !== null && (
        <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-100">
          <div className="text-[11px] text-indigo-500 font-medium">平均响应时间</div>
          <div className="text-[18px] font-bold text-indigo-700 mt-0.5">
            {avgResponseTime < 1000 ? `${Math.round(avgResponseTime)}ms` : `${(avgResponseTime / 1000).toFixed(1)}s`}
          </div>
        </div>
      )}

      {/* 消息类型分布 */}
      {typeStats.length > 0 && (
        <div>
          <h4 className="text-[12px] font-medium text-gray-600 mb-2 flex items-center gap-1.5">
            <BarChartOutlined className="text-indigo-400" />
            消息类型分布
          </h4>
          <div className="space-y-2">
            {typeStats.map(([type, count]) => {
              const cfg = messageTypeConfig[type] || { label: type, color: 'default' }
              const pct = messages.length > 0 ? Math.round((count / messages.length) * 100) : 0
              return (
                <div key={type} className="flex items-center gap-3">
                  <Tag color={cfg.color} className="!text-[10px] !m-0 min-w-[70px] text-center">
                    {cfg.label}
                  </Tag>
                  <div className="flex-1 h-5 bg-gray-50 rounded-full overflow-hidden relative">
                    <div
                      className="h-full bg-indigo-100 rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500">
                      {count} ({pct}%)
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 优先级分布 */}
      {priorityStats.size > 0 && (
        <div>
          <h4 className="text-[12px] font-medium text-gray-600 mb-2">优先级分布</h4>
          <div className="flex gap-3">
            {['critical', 'high', 'normal', 'low'].map((pri) => {
              const count = priorityStats.get(pri) || 0
              if (count === 0) return null
              const cfg = priorityConfig[pri]
              return (
                <div key={pri} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 rounded-lg">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
                  <span className="text-[11px] text-gray-600">{cfg.label}</span>
                  <span className="text-[11px] font-bold text-gray-800">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Agent 活跃度 */}
      {agentStats.length > 0 && (
        <div>
          <h4 className="text-[12px] font-medium text-gray-600 mb-2 flex items-center gap-1.5">
            <TeamOutlined className="text-indigo-400" />
            Agent 活跃度
          </h4>
          <div className="space-y-1.5">
            {agentStats.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 px-3 py-2 bg-white rounded-lg border border-gray-50">
                <span className="text-[11px] font-medium text-gray-700 min-w-[120px] truncate">{agent.id}</span>
                <div className="flex-1 flex items-center gap-3">
                  <span className="text-[10px] text-indigo-500">↑ 发送 {agent.sent}</span>
                  <span className="text-[10px] text-green-500">↓ 接收 {agent.received}</span>
                </div>
                <span className="text-[10px] font-medium text-gray-500">共 {agent.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 状态分布饼图（简化版） */}
      {stats && stats.total > 0 && (
        <div>
          <h4 className="text-[12px] font-medium text-gray-600 mb-2">状态分布</h4>
          <div className="flex items-center gap-4 flex-wrap">
            {Object.entries(messageStatusConfig).map(([status, cfg]) => {
              const count = (stats as any)[status] || 0
              if (count === 0) return null
              return (
                <div key={status} className="flex items-center gap-1.5">
                  <Tag color={cfg.color} className="!text-[10px] !m-0">{cfg.label}</Tag>
                  <span className="text-[11px] font-bold text-gray-700">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// 统计卡片
function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="px-4 py-3 bg-white rounded-lg border border-gray-100 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px]"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        <div>
          <div className="text-[18px] font-bold text-gray-800">{value}</div>
          <div className="text-[10px] text-gray-400">{label}</div>
        </div>
      </div>
    </div>
  )
}
