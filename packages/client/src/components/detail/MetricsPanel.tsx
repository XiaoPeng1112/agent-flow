import { useState, useEffect } from 'react'
import { Tag, Tooltip, Empty, Spin, Progress, Table, Button } from 'antd'
import {
  ClockCircleOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  RiseOutlined,
  FieldTimeOutlined,
  FireOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { metricsApi, feedbackApi } from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

interface RunMetrics {
  runId: string
  totalDuration: number
  tokenUsage: { input: number; output: number; total: number }
  toolCallCount: number
  firstPassApprovalRate: number
  averageNodeDuration: number
  parallelismRatio: number
  bottleneckNodeId?: string
  nodeMetrics: NodeMetrics[]
  timeline: TimelineEntry[]
}

interface NodeMetrics {
  nodeId: string
  nodeName: string
  nodeType: string
  agentRole: string
  totalDuration: number
  waitDuration: number
  executionDuration: number
  retryCount: number
  firstPassApproved: boolean
  finalStatus: string
  startedAt?: number
  completedAt?: number
  turns: any[]
}

interface TimelineEntry {
  nodeId: string
  nodeName: string
  nodeType: string
  status: string
  startedAt: number
  completedAt?: number
  duration: number
  segments: Array<{
    type: 'execution' | 'waiting' | 'review'
    startedAt: number
    completedAt: number
    duration: number
    label?: string
  }>
}

interface TokenDistribution {
  nodeId: string
  nodeName: string
  input: number
  output: number
  total: number
  percentage: number
}

interface EfficiencyEntry {
  nodeId: string
  nodeName: string
  nodeType: string
  duration: number
  retryCount: number
  firstPassApproved: boolean
  tokenUsage: number
  efficiencyScore: number
}

export function MetricsPanel({ run }: Props) {
  const [metrics, setMetrics] = useState<RunMetrics | null>(null)
  const [tokenDist, setTokenDist] = useState<TokenDistribution[]>([])
  const [efficiency, setEfficiency] = useState<EfficiencyEntry[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'tokens' | 'efficiency' | 'feedback'>('overview')
  const [feedbackEntries, setFeedbackEntries] = useState<any[]>([])
  const [feedbackStats, setFeedbackStats] = useState<any>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [metricsRes, tokenRes, effRes, fbRes, statsRes] = await Promise.all([
          metricsApi.getRunMetrics(run.id),
          metricsApi.getTokenDistribution(run.id),
          metricsApi.getEfficiency(run.id),
          feedbackApi.query({ runId: run.id, limit: 50 }),
          feedbackApi.getStats(7),
        ])
        setMetrics(metricsRes.metrics)
        setTokenDist(tokenRes.distribution || [])
        setEfficiency(effRes.table || [])
        setFeedbackEntries(fbRes.entries || [])
        setFeedbackStats(statsRes.stats || null)
      } catch {
        // 数据不可用
      } finally {
        setLoading(false); setHasLoaded(true)
      }
    }
    load()
  }, [run.id])

  if (loading && !hasLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin tip="计算指标..." />
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty description="暂无指标数据" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <p className="text-[11px] text-gray-400 mt-2">Run 开始执行后将自动采集指标</p>
        </Empty>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 子标签页 */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-gray-100">
        {([
          { key: 'overview', label: '总览', icon: <RiseOutlined /> },
          { key: 'timeline', label: '时间线', icon: <FieldTimeOutlined /> },
          { key: 'tokens', label: 'Token 分布', icon: <ThunderboltOutlined /> },
          { key: 'efficiency', label: '效率', icon: <FireOutlined /> },
          { key: 'feedback', label: '反馈', icon: <MessageOutlined /> },
        ] as { key: typeof activeTab; label: string; icon: React.ReactNode }[]).map(tab => (
          <button
            key={tab.key}
            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md transition-colors ${
              activeTab === tab.key
                ? 'bg-indigo-50 text-indigo-600 font-medium'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {activeTab === 'overview' && <OverviewSection metrics={metrics} />}
        {activeTab === 'timeline' && <TimelineSection metrics={metrics} />}
        {activeTab === 'tokens' && <TokenSection distribution={tokenDist} total={metrics.tokenUsage} />}
        {activeTab === 'efficiency' && <EfficiencySection entries={efficiency} />}
        {activeTab === 'feedback' && <FeedbackSection entries={feedbackEntries} stats={feedbackStats} runId={run.id} />}
      </div>
    </div>
  )
}

// ═══════════════ Overview Section ═══════════════

function OverviewSection({ metrics }: { metrics: RunMetrics }) {
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  }

  const cards = [
    {
      label: '总耗时',
      value: formatDuration(metrics.totalDuration),
      icon: <ClockCircleOutlined />,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Token 消耗',
      value: metrics.tokenUsage.total.toLocaleString(),
      icon: <ThunderboltOutlined />,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      sub: `输入 ${metrics.tokenUsage.input.toLocaleString()} / 输出 ${metrics.tokenUsage.output.toLocaleString()}`,
    },
    {
      label: '一次通过率',
      value: `${Math.round(metrics.firstPassApprovalRate * 100)}%`,
      icon: <CheckCircleOutlined />,
      color: metrics.firstPassApprovalRate >= 0.8 ? 'text-green-600' : 'text-amber-600',
      bg: metrics.firstPassApprovalRate >= 0.8 ? 'bg-green-50' : 'bg-amber-50',
    },
    {
      label: '工具调用',
      value: metrics.toolCallCount.toString(),
      icon: <FireOutlined />,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      label: '平均节点耗时',
      value: formatDuration(metrics.averageNodeDuration),
      icon: <FieldTimeOutlined />,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
    },
    {
      label: '并行度',
      value: `${Math.round(metrics.parallelismRatio * 100)}%`,
      icon: <RiseOutlined />,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
    },
  ]

  return (
    <div className="space-y-6">
      {/* 指标卡片网格 */}
      <div className="grid grid-cols-3 gap-3">
        {cards.map(card => (
          <div key={card.label} className={`${card.bg} rounded-xl p-4 border border-gray-100`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[14px] ${card.color}`}>{card.icon}</span>
              <span className="text-[11px] text-gray-500">{card.label}</span>
            </div>
            <div className={`text-[18px] font-bold ${card.color}`}>{card.value}</div>
            {card.sub && <div className="text-[10px] text-gray-400 mt-1">{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* 瓶颈提示 */}
      {metrics.bottleneckNodeId && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg">
          <WarningOutlined className="text-amber-500" />
          <span className="text-[12px] text-amber-700">
            瓶颈节点：
            <span className="font-medium">
              {metrics.nodeMetrics?.find(n => n.nodeId === metrics.bottleneckNodeId)?.nodeName || metrics.bottleneckNodeId}
            </span>
            （耗时最长）
          </span>
        </div>
      )}

      {/* 节点状态分布 */}
      <div>
        <h4 className="text-[12px] font-medium text-gray-700 mb-3">节点状态分布</h4>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(
            (metrics.nodeMetrics ?? []).reduce((acc, nm) => {
              acc[nm.finalStatus] = (acc[nm.finalStatus] || 0) + 1
              return acc
            }, {} as Record<string, number>)
          ).map(([status, count]) => (
            <Tag key={status} color={
              status === 'completed' ? 'success' :
              status === 'failed' ? 'error' :
              status === 'running' ? 'processing' :
              'default'
            }>
              {status}: {count}
            </Tag>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════ Timeline Section (甘特图) ═══════════════

function TimelineSection({ metrics }: { metrics: RunMetrics }) {
  const timeline = metrics.timeline ?? []
  if (timeline.length === 0) {
    return <Empty description="暂无时间线数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const minTime = Math.min(...timeline.map(t => t.startedAt))
  const maxTime = Math.max(...timeline.map(t => t.completedAt || Date.now()))
  const totalSpan = maxTime - minTime || 1

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const statusColors: Record<string, string> = {
    completed: '#10b981',
    running: '#f59e0b',
    failed: '#ef4444',
    wait_user_review: '#f97316',
    skipped: '#9ca3af',
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] text-gray-400 mb-4">
        总时间跨度：{formatDuration(totalSpan)}
      </div>
      {timeline.map(entry => {
        const left = ((entry.startedAt - minTime) / totalSpan) * 100
        const width = Math.max(1, (entry.duration / totalSpan) * 100)
        const color = statusColors[entry.status] || '#6b7280'

        return (
          <div key={entry.nodeId} className="flex items-center gap-3 py-1.5">
            {/* 节点名 */}
            <div className="w-[120px] shrink-0 text-[11px] text-gray-600 truncate text-right" title={entry.nodeName}>
              {entry.nodeName}
            </div>
            {/* 甘特条 */}
            <div className="flex-1 relative h-[24px] bg-gray-50 rounded overflow-hidden">
              <Tooltip title={`${entry.nodeName}: ${formatDuration(entry.duration)}`}>
                <div
                  className="absolute top-[3px] bottom-[3px] rounded-sm transition-all"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: color,
                    minWidth: '4px',
                  }}
                />
              </Tooltip>
              {/* 分段（如果有多轮） */}
              {(entry.segments?.length ?? 0) > 1 && entry.segments.map((seg, i) => {
                const segLeft = ((seg.startedAt - minTime) / totalSpan) * 100
                const segWidth = Math.max(0.5, (seg.duration / totalSpan) * 100)
                const segColor = seg.type === 'review' ? '#f97316' : seg.type === 'waiting' ? '#9ca3af' : color
                return (
                  <Tooltip key={i} title={`${seg.label || seg.type}: ${formatDuration(seg.duration)}`}>
                    <div
                      className="absolute top-[3px] bottom-[3px] rounded-sm opacity-80 border border-white/50"
                      style={{
                        left: `${segLeft}%`,
                        width: `${segWidth}%`,
                        backgroundColor: segColor,
                        minWidth: '2px',
                      }}
                    />
                  </Tooltip>
                )
              })}
            </div>
            {/* 耗时 */}
            <div className="w-[60px] shrink-0 text-[10px] text-gray-400 text-left">
              {formatDuration(entry.duration)}
            </div>
          </div>
        )
      })}

      {/* 图例 */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100">
        {[
          { label: '执行', color: '#10b981' },
          { label: '等待确认', color: '#f97316' },
          { label: '失败', color: '#ef4444' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: item.color }} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════ Token Distribution Section ═══════════════

function TokenSection({ distribution, total }: { distribution: TokenDistribution[]; total: { input: number; output: number; total: number } }) {
  if (distribution.length === 0) {
    return <Empty description="暂无 Token 数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const colors = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6']

  return (
    <div className="space-y-6">
      {/* 总量卡片 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-purple-50 rounded-lg p-3 text-center">
          <div className="text-[10px] text-purple-400">总计</div>
          <div className="text-[16px] font-bold text-purple-600">{total.total.toLocaleString()}</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <div className="text-[10px] text-blue-400">输入</div>
          <div className="text-[16px] font-bold text-blue-600">{total.input.toLocaleString()}</div>
        </div>
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <div className="text-[10px] text-green-400">输出</div>
          <div className="text-[16px] font-bold text-green-600">{total.output.toLocaleString()}</div>
        </div>
      </div>

      {/* 分布柱状图 */}
      <div>
        <h4 className="text-[12px] font-medium text-gray-700 mb-3">按节点分布</h4>
        <div className="space-y-2">
          {distribution.map((item, idx) => (
            <div key={item.nodeId} className="flex items-center gap-3">
              <div className="w-[100px] shrink-0 text-[11px] text-gray-600 truncate text-right" title={item.nodeName}>
                {item.nodeName}
              </div>
              <div className="flex-1 relative h-[20px] bg-gray-100 rounded overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded transition-all"
                  style={{
                    width: `${item.percentage}%`,
                    backgroundColor: colors[idx % colors.length],
                    minWidth: item.percentage > 0 ? '4px' : '0',
                  }}
                />
              </div>
              <div className="w-[80px] shrink-0 text-[10px] text-gray-500 text-right">
                {item.total.toLocaleString()} ({item.percentage}%)
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════ Efficiency Section ═══════════════

function EfficiencySection({ entries }: { entries: EfficiencyEntry[] }) {
  if (entries.length === 0) {
    return <Empty description="暂无效率数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const columns = [
    {
      title: '节点',
      dataIndex: 'nodeName',
      key: 'nodeName',
      width: 140,
      render: (name: string, record: EfficiencyEntry) => (
        <div>
          <div className="text-[11px] font-medium text-gray-700">{name}</div>
          <div className="text-[10px] text-gray-400">{record.nodeType}</div>
        </div>
      ),
    },
    {
      title: '效率',
      dataIndex: 'efficiencyScore',
      key: 'efficiencyScore',
      width: 100,
      sorter: (a: EfficiencyEntry, b: EfficiencyEntry) => a.efficiencyScore - b.efficiencyScore,
      render: (score: number) => (
        <Progress
          percent={score}
          size="small"
          strokeColor={score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444'}
          format={(p) => <span className="text-[10px]">{p}</span>}
        />
      ),
    },
    {
      title: '耗时',
      dataIndex: 'duration',
      key: 'duration',
      width: 80,
      sorter: (a: EfficiencyEntry, b: EfficiencyEntry) => a.duration - b.duration,
      render: (d: number) => <span className="text-[11px]">{formatDuration(d)}</span>,
    },
    {
      title: 'Retry',
      dataIndex: 'retryCount',
      key: 'retryCount',
      width: 60,
      render: (count: number) => (
        <Tag color={count === 0 ? 'default' : count <= 2 ? 'warning' : 'error'} className="!text-[10px]">
          {count}
        </Tag>
      ),
    },
    {
      title: '一次通过',
      dataIndex: 'firstPassApproved',
      key: 'firstPassApproved',
      width: 70,
      render: (passed: boolean) =>
        passed
          ? <CheckCircleOutlined className="text-green-500" />
          : <WarningOutlined className="text-amber-500" />,
    },
    {
      title: 'Tokens',
      dataIndex: 'tokenUsage',
      key: 'tokenUsage',
      width: 80,
      sorter: (a: EfficiencyEntry, b: EfficiencyEntry) => a.tokenUsage - b.tokenUsage,
      render: (t: number) => <span className="text-[11px]">{t.toLocaleString()}</span>,
    },
  ]

  return (
    <div>
      <div className="mb-3 text-[11px] text-gray-400">
        效率评分综合考虑一次通过率、耗时和 Token 消耗（分数越高越好）
      </div>
      <Table
        dataSource={entries}
        columns={columns}
        rowKey="nodeId"
        size="small"
        pagination={false}
        className="[&_.ant-table-cell]:!py-2 [&_.ant-table-cell]:!text-[11px]"
        rowClassName={(record) =>
          record.efficiencyScore < 40 ? '!bg-red-50/30' : ''
        }
      />
    </div>
  )
}

// ═══════════════ Feedback Section ═══════════════

function FeedbackSection({ entries, stats, runId: _runId }: { entries: any[]; stats: any; runId: string }) {
  const [generating, setGenerating] = useState(false)

  const handleGenerateDigest = async () => {
    setGenerating(true)
    try {
      await feedbackApi.generateDigest(7)
      // 成功后提示
    } catch {
      // 失败静默
    } finally {
      setGenerating(false)
    }
  }

  const severityColors: Record<string, string> = {
    critical: 'red',
    high: 'orange',
    medium: 'gold',
    low: 'default',
  }

  const typeLabels: Record<string, string> = {
    review_reject: '审批打回',
    diff_discard: 'Diff 丢弃',
    execution_failure: '执行失败',
    manual_note: '备注',
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div>
      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-[18px] font-bold text-gray-800">{stats.total || 0}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">总反馈</div>
          </div>
          <div className="bg-red-50 rounded-lg p-3 text-center">
            <div className="text-[18px] font-bold text-red-600">{stats.byType?.review_reject || 0}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">打回</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 text-center">
            <div className="text-[18px] font-bold text-orange-600">{stats.byType?.execution_failure || 0}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">失败</div>
          </div>
          <div className="bg-amber-50 rounded-lg p-3 text-center">
            <div className="text-[18px] font-bold text-amber-600">{stats.byType?.diff_discard || 0}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Diff 丢弃</div>
          </div>
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] text-gray-500">
          {entries.length > 0 ? `本 Run 共 ${entries.length} 条反馈` : '暂无反馈记录'}
        </span>
        <Button
          size="small"
          type="primary"
          ghost
          loading={generating}
          onClick={handleGenerateDigest}
          className="!text-[11px]"
        >
          生成周报摘要
        </Button>
      </div>

      {/* 反馈列表 */}
      {entries.length === 0 ? (
        <Empty description="执行过程中的打回、丢弃、失败事件将自动记录在此" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="space-y-2">
          {entries.map((entry: any) => (
            <div key={entry.id} className="bg-white border border-gray-100 rounded-lg p-3 hover:border-gray-200 transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Tag color={severityColors[entry.severity] || 'default'} className="!text-[10px] !px-1.5">
                    {entry.severity}
                  </Tag>
                  <Tag className="!text-[10px] !px-1.5">
                    {typeLabels[entry.type] || entry.type}
                  </Tag>
                </div>
                <span className="text-[10px] text-gray-400">{formatTime(entry.timestamp)}</span>
              </div>
              <div className="text-[12px] text-gray-700 font-medium">{entry.summary}</div>
              {entry.details && (
                <div className="text-[11px] text-gray-500 mt-1 line-clamp-2">{entry.details}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
