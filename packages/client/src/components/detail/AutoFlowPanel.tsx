import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, Tag, Progress, Table, Empty, Spin, Alert, Tooltip, Statistic, Space } from 'antd'
import {
  CheckCircleOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  SafetyOutlined,
  BarChartOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import {
  autoFlowApi,
  type AutoFlowAdaptiveStats,
  type AutoFlowRunSummary,
  type ConfidenceSignals,
} from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

// ─── 信号名称映射 ───
const SIGNAL_LABELS: Record<keyof ConfidenceSignals, string> = {
  feedbackPositive: '正向反馈',
  contextRelevance: '上下文相关性',
  historicalPassRate: '历史通过率',
  outputQuality: '输出质量',
  executionStability: '执行稳定性',
  mergeConflictFree: '无合并冲突',
}

const SIGNAL_COLORS: Record<keyof ConfidenceSignals, string> = {
  feedbackPositive: '#52c41a',
  contextRelevance: '#1890ff',
  historicalPassRate: '#722ed1',
  outputQuality: '#fa8c16',
  executionStability: '#13c2c2',
  mergeConflictFree: '#eb2f96',
}

export function AutoFlowPanel({ run }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adaptiveStats, setAdaptiveStats] = useState<AutoFlowAdaptiveStats | null>(null)
  const [runSummary, setRunSummary] = useState<AutoFlowRunSummary | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, summaryRes] = await Promise.allSettled([
        autoFlowApi.getAdaptiveStats(),
        autoFlowApi.getRunSummary(run.id),
      ])
      if (statsRes.status === 'fulfilled') setAdaptiveStats(statsRes.value.stats)
      if (summaryRes.status === 'fulfilled') setRunSummary(summaryRes.value)
      if (statsRes.status === 'rejected' && summaryRes.status === 'rejected') {
        setError('AutoFlow 引擎未启用或无法获取数据')
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [run.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Spin size="large" tip="加载 AutoFlow 数据..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert type="warning" message="AutoFlow 不可用" description={error} showIcon />
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* 顶部概览统计 */}
      <OverviewSection stats={adaptiveStats} summary={runSummary} />

      {/* 信号权重雷达图（用 CSS 实现的简化版） */}
      {adaptiveStats && <SignalWeightsSection stats={adaptiveStats} />}

      {/* 贝叶斯自适应学习状态 */}
      {adaptiveStats && <BayesianSection stats={adaptiveStats} />}

      {/* 本 Run 节点评估列表 */}
      {runSummary && <EvaluationListSection summary={runSummary} />}

      {/* 置信度历史时间线 */}
      {(adaptiveStats?.confidenceHistory?.length ?? 0) > 0 && (
        <ConfidenceHistorySection history={adaptiveStats!.confidenceHistory} />
      )}
    </div>
  )
}

// ═══════════════ 概览统计 ═══════════════

function OverviewSection({ stats, summary }: { stats: AutoFlowAdaptiveStats | null; summary: AutoFlowRunSummary | null }) {
  const totalEval = stats?.totalEvaluations ?? summary?.totalEvaluated ?? 0
  const autoApproved = stats?.autoApproved ?? summary?.autoApproved ?? 0
  const requireReview = stats?.requireReview ?? summary?.requireReview ?? 0
  const avgConfidence = stats?.averageConfidence ?? 0
  const autoRate = totalEval > 0 ? Math.round((autoApproved / totalEval) * 100) : 0

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card size="small" className="!border-green-200 !bg-green-50/50">
        <Statistic
          title={<span className="text-xs text-gray-500">自动放行</span>}
          value={autoApproved}
          suffix={<span className="text-xs text-gray-400">/ {totalEval}</span>}
          valueStyle={{ color: '#52c41a', fontSize: '24px' }}
          prefix={<CheckCircleOutlined />}
        />
      </Card>
      <Card size="small" className="!border-orange-200 !bg-orange-50/50">
        <Statistic
          title={<span className="text-xs text-gray-500">需人工审核</span>}
          value={requireReview}
          valueStyle={{ color: '#fa8c16', fontSize: '24px' }}
          prefix={<EyeOutlined />}
        />
      </Card>
      <Card size="small" className="!border-blue-200 !bg-blue-50/50">
        <Statistic
          title={<span className="text-xs text-gray-500">自动化率</span>}
          value={autoRate}
          suffix="%"
          valueStyle={{ color: '#1890ff', fontSize: '24px' }}
          prefix={<ThunderboltOutlined />}
        />
      </Card>
      <Card size="small" className="!border-purple-200 !bg-purple-50/50">
        <Statistic
          title={<span className="text-xs text-gray-500">平均信心分</span>}
          value={avgConfidence}
          precision={1}
          valueStyle={{ color: '#722ed1', fontSize: '24px' }}
          prefix={<SafetyOutlined />}
        />
      </Card>
    </div>
  )
}

// ═══════════════ 信号权重可视化 ═══════════════

function SignalWeightsSection({ stats }: { stats: AutoFlowAdaptiveStats }) {
  const signalEntries = useMemo(() => {
    const entries = Object.entries(stats?.signalWeights ?? {}) as [keyof ConfidenceSignals, number][]
    return entries.sort((a, b) => b[1] - a[1])
  }, [stats?.signalWeights])

  if (signalEntries.length === 0) {
    return null
  }

  const maxWeight = Math.max(...signalEntries.map(([, w]) => w), 1)

  return (
    <Card
      title={
        <Space>
          <BarChartOutlined />
          <span>信号权重分布</span>
          <Tooltip title="AutoFlow 使用 6 信号加权计算信心分，各信号权重反映其对最终决策的贡献程度">
            <InfoCircleOutlined className="text-gray-400" />
          </Tooltip>
        </Space>
      }
      size="small"
    >
      <div className="space-y-3">
        {signalEntries.map(([signal, weight]) => {
          const label = SIGNAL_LABELS[signal] || signal
          const color = SIGNAL_COLORS[signal] || '#8c8c8c'
          const percent = Math.round((weight / maxWeight) * 100)
          return (
            <div key={signal} className="flex items-center gap-3">
              <div className="w-28 text-xs text-gray-600 shrink-0 text-right">{label}</div>
              <div className="flex-1">
                <Progress
                  percent={percent}
                  strokeColor={color}
                  showInfo={false}
                  size="small"
                />
              </div>
              <div className="w-12 text-xs text-gray-500 text-right">{weight.toFixed(2)}</div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ═══════════════ 贝叶斯学习状态 ═══════════════

function BayesianSection({ stats }: { stats: AutoFlowAdaptiveStats }) {
  const { bayesianPrior } = stats
  if (!bayesianPrior) return null

  const { alpha, beta, mean } = bayesianPrior
  const total = alpha + beta
  const confidence = total > 10 ? '高' : total > 5 ? '中' : '低'
  const confidenceColor = total > 10 ? 'green' : total > 5 ? 'orange' : 'default'

  return (
    <Card
      title={
        <Space>
          <ExperimentIcon />
          <span>贝叶斯自适应学习</span>
          <Tooltip title="系统通过 Beta 分布动态调整对自动放行结果的信心，α 代表成功次数，β 代表失败次数，均值越高说明系统越有信心">
            <InfoCircleOutlined className="text-gray-400" />
          </Tooltip>
        </Space>
      }
      size="small"
    >
      <div className="grid grid-cols-3 gap-6">
        <div className="text-center">
          <div className="text-2xl font-semibold text-green-600">{alpha}</div>
          <div className="text-xs text-gray-500 mt-1">α (成功)</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-semibold text-red-500">{beta}</div>
          <div className="text-xs text-gray-500 mt-1">β (失败)</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-semibold text-indigo-600">{(mean * 100).toFixed(1)}%</div>
          <div className="text-xs text-gray-500 mt-1">后验均值</div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between px-2">
        <span className="text-xs text-gray-500">学习样本总量: {total}</span>
        <Tag color={confidenceColor}>置信度: {confidence}</Tag>
      </div>
      <Progress
        percent={Math.round(mean * 100)}
        strokeColor={{ '0%': '#ff4d4f', '50%': '#faad14', '100%': '#52c41a' }}
        className="mt-2"
        format={() => `${(mean * 100).toFixed(1)}%`}
      />
    </Card>
  )
}

function ExperimentIcon() {
  return <span style={{ fontSize: '14px' }}>🧪</span>
}

// ═══════════════ 节点评估列表 ═══════════════

function EvaluationListSection({ summary }: { summary: AutoFlowRunSummary }) {
  if (!summary?.evaluations?.length) {
    return (
      <Card title="节点评估记录" size="small">
        <Empty description="本 Run 尚无 AutoFlow 评估记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    )
  }

  const columns = [
    {
      title: '节点',
      dataIndex: 'nodeName',
      key: 'nodeName',
      render: (name: string) => <span className="font-medium text-gray-700">{name}</span>,
    },
    {
      title: '决策',
      dataIndex: ['evaluation', 'decision'],
      key: 'decision',
      width: 140,
      render: (decision: string) => (
        decision === 'auto_approve'
          ? <Tag color="green" icon={<CheckCircleOutlined />}>自动放行</Tag>
          : <Tag color="orange" icon={<EyeOutlined />}>需人工审核</Tag>
      ),
    },
    {
      title: '信心分',
      dataIndex: ['evaluation', 'confidence'],
      key: 'confidence',
      width: 120,
      render: (conf: number) => (
        <Progress
          percent={Math.round(conf)}
          size="small"
          strokeColor={conf >= 75 ? '#52c41a' : conf >= 50 ? '#faad14' : '#ff4d4f'}
          format={() => `${conf.toFixed(1)}`}
        />
      ),
    },
    {
      title: '决策理由',
      dataIndex: ['evaluation', 'reasoning'],
      key: 'reasoning',
      render: (reasons: string[] | undefined) => {
        if (!reasons?.length) return <span className="text-xs text-gray-400">-</span>
        return (
          <div className="space-y-0.5">
            {reasons.slice(0, 3).map((r, i) => (
              <div key={i} className="text-xs text-gray-500">{r}</div>
            ))}
            {reasons.length > 3 && <span className="text-xs text-gray-400">... +{reasons.length - 3} 条</span>}
          </div>
        )
      },
    },
  ]

  return (
    <Card title="节点评估记录" size="small" extra={<Tag>{summary.evaluations.length} 条</Tag>}>
      <Table
        dataSource={summary.evaluations}
        columns={columns}
        rowKey="nodeId"
        size="small"
        pagination={false}
        scroll={{ y: 300 }}
      />
    </Card>
  )
}

// ═══════════════ 置信度历史时间线 ═══════════════

function ConfidenceHistorySection({ history }: { history: AutoFlowAdaptiveStats['confidenceHistory'] }) {
  // 取最近 20 条
  const recentHistory = useMemo(() => history.slice(-20), [history])

  const maxConf = Math.max(...recentHistory.map(h => h.confidence), 100)

  return (
    <Card title="置信度变化趋势" size="small" extra={<Tag>最近 {recentHistory.length} 次评估</Tag>}>
      {/* 简化版柱状图 */}
      <div className="flex items-end gap-1 h-32 px-2">
        {recentHistory.map((item, idx) => {
          const height = (item.confidence / maxConf) * 100
          const color = item.decision === 'auto_approve' ? '#52c41a' : '#fa8c16'
          return (
            <Tooltip
              key={idx}
              title={
                <div className="text-xs">
                  <div>信心分: {item.confidence.toFixed(1)}</div>
                  <div>决策: {item.decision === 'auto_approve' ? '自动放行' : '需审核'}</div>
                  <div>时间: {new Date(item.timestamp).toLocaleString()}</div>
                </div>
              }
            >
              <div
                className="flex-1 rounded-t-sm transition-all hover:opacity-80 cursor-pointer min-w-[8px]"
                style={{ height: `${height}%`, backgroundColor: color }}
              />
            </Tooltip>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1 px-2">
        <span>← 旧</span>
        <span>新 →</span>
      </div>
    </Card>
  )
}
