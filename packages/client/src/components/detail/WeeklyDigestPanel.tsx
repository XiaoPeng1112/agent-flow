import { useState, useEffect, useCallback } from 'react'
import { Card, Tag, Table, Empty, Spin, Alert, Button, Space, Statistic, Badge, Progress } from 'antd'
import {
  RiseOutlined,
  FallOutlined,
  MinusOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
} from '@ant-design/icons'
import {
  feedbackApi,
  type DigestData,
  type TrendAnalysis,
  type MetricTrend,
  type Anomaly,
  type SignalHealthReport,
  type TrendDirection,
} from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

export function WeeklyDigestPanel({ run: _run }: Props) {
  const [loading, setLoading] = useState(false)
  const [digest, setDigest] = useState<DigestData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generateDigest = useCallback(async (days = 7) => {
    setLoading(true)
    setError(null)
    try {
      const res = await feedbackApi.generateDigest(days)
      setDigest(res.digest)
    } catch (err: any) {
      setError(err.message || '生成摘要失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    generateDigest()
  }, [generateDigest])

  if (loading && !digest) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Spin size="large" tip="正在生成周报摘要..." />
      </div>
    )
  }

  if (error && !digest) {
    return (
      <div className="p-6">
        <Alert
          type="error"
          message="摘要生成失败"
          description={error}
          showIcon
          action={<Button size="small" onClick={() => generateDigest()}>重试</Button>}
        />
      </div>
    )
  }

  if (!digest) {
    return (
      <div className="p-6">
        <Empty description="暂无周报数据" />
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* 头部信息 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 m-0">
            周报摘要
          </h3>
          <div className="text-xs text-gray-500 mt-1">
            {digest.period.start} ~ {digest.period.end}
            <span className="ml-3 text-gray-400">
              生成于 {new Date(digest.generatedAt).toLocaleString()}
            </span>
          </div>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => generateDigest()}
          loading={loading}
          size="small"
        >
          重新生成
        </Button>
      </div>

      {/* 运行概览 */}
      <RunsSummarySection data={digest.runsSummary} />

      {/* 趋势分析 */}
      {digest.trendAnalysis && <TrendSection trend={digest.trendAnalysis} />}

      {/* 异常检测 */}
      {(digest.anomalies?.length ?? 0) > 0 && <AnomalySection anomalies={digest.anomalies} />}

      {/* 信号健康度 */}
      {(digest.signalHealth?.signals?.length ?? 0) > 0 && <SignalHealthSection report={digest.signalHealth} />}

      {/* AutoFlow 指标 */}
      {digest.autoFlowMetrics && <AutoFlowMetricsSection metrics={digest.autoFlowMetrics} />}

      {/* 高频问题 */}
      {(digest.topIssues?.length ?? 0) > 0 && <TopIssuesSection issues={digest.topIssues} />}

      {/* Agent 表现 */}
      {(digest.agentPerformance?.length ?? 0) > 0 && <AgentPerformanceSection data={digest.agentPerformance} />}
    </div>
  )
}

// ═══════════════ 运行概览 ═══════════════

function RunsSummarySection({ data }: { data: DigestData['runsSummary'] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Card size="small" className="!border-gray-200">
        <Statistic title={<span className="text-xs">总运行</span>} value={data.totalRuns} valueStyle={{ fontSize: '20px' }} />
      </Card>
      <Card size="small" className="!border-green-200 !bg-green-50/30">
        <Statistic title={<span className="text-xs">已完成</span>} value={data.completedRuns} valueStyle={{ fontSize: '20px', color: '#52c41a' }} prefix={<CheckCircleOutlined />} />
      </Card>
      <Card size="small" className="!border-red-200 !bg-red-50/30">
        <Statistic title={<span className="text-xs">失败</span>} value={data.failedRuns} valueStyle={{ fontSize: '20px', color: '#ff4d4f' }} prefix={<ExclamationCircleOutlined />} />
      </Card>
      <Card size="small" className="!border-blue-200">
        <Statistic title={<span className="text-xs">平均耗时</span>} value={formatDuration(data.averageDuration)} valueStyle={{ fontSize: '16px' }} prefix={<ClockCircleOutlined />} />
      </Card>
      <Card size="small" className="!border-purple-200">
        <Statistic title={<span className="text-xs">Token 消耗</span>} value={data.totalTokens} valueStyle={{ fontSize: '16px' }} prefix={<ThunderboltOutlined />} formatter={(v) => formatNumber(v as number)} />
      </Card>
    </div>
  )
}

// ═══════════════ 趋势分析 ═══════════════

const TREND_ICON: Record<TrendDirection, React.ReactNode> = {
  improving: <RiseOutlined className="text-green-500" />,
  stable: <MinusOutlined className="text-gray-400" />,
  degrading: <FallOutlined className="text-red-500" />,
}

const TREND_LABEL: Record<TrendDirection, { text: string; color: string }> = {
  improving: { text: '向好', color: 'green' },
  stable: { text: '平稳', color: 'default' },
  degrading: { text: '恶化', color: 'red' },
}

function TrendSection({ trend }: { trend: TrendAnalysis }) {
  const trendRows: Array<{ label: string; metric: MetricTrend; isPercent?: boolean; isDuration?: boolean }> = [
    { label: '运行次数', metric: trend.runCount },
    { label: '完成率', metric: trend.completionRate, isPercent: true },
    { label: '平均耗时', metric: trend.averageDuration, isDuration: true },
    { label: 'Token 消耗', metric: trend.tokenUsage },
    { label: '一次通过率', metric: trend.firstPassRate, isPercent: true },
  ]
  if (trend.autoApproveRate) trendRows.push({ label: '自动放行率', metric: trend.autoApproveRate, isPercent: true })
  if (trend.accuracy) trendRows.push({ label: '放行准确率', metric: trend.accuracy, isPercent: true })

  return (
    <Card
      title={
        <Space>
          <BarChartOutlined />
          <span>趋势分析</span>
          <Tag color={TREND_LABEL[trend.overallDirection].color}>
            {TREND_ICON[trend.overallDirection]} {TREND_LABEL[trend.overallDirection].text}
          </Tag>
        </Space>
      }
      size="small"
    >
      <div className="space-y-2">
        {trendRows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 py-1 border-b border-gray-50 last:border-0">
            <div className="w-24 text-xs text-gray-600 shrink-0">{row.label}</div>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {formatTrendValue(row.metric.previous, row.isPercent, row.isDuration)}
              </span>
              <span className="text-gray-300">→</span>
              <span className="text-sm font-medium text-gray-700">
                {formatTrendValue(row.metric.current, row.isPercent, row.isDuration)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {TREND_ICON[row.metric.direction]}
              <span className={`text-xs font-medium ${
                row.metric.direction === 'improving' ? 'text-green-600' :
                row.metric.direction === 'degrading' ? 'text-red-500' : 'text-gray-400'
              }`}>
                {row.metric.changePercent >= 0 ? '+' : ''}{row.metric.changePercent}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ═══════════════ 异常检测 ═══════════════

function AnomalySection({ anomalies }: { anomalies: Anomaly[] }) {
  const negativeAnomalies = anomalies.filter(a => a.isNegative)
  const positiveAnomalies = anomalies.filter(a => !a.isNegative)

  return (
    <Card
      title={
        <Space>
          <WarningOutlined className="text-orange-500" />
          <span>异常检测</span>
          <Badge count={negativeAnomalies.length} style={{ backgroundColor: '#ff4d4f' }} />
        </Space>
      }
      size="small"
    >
      {negativeAnomalies.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-red-600 mb-2">需要关注</div>
          <div className="space-y-2">
            {negativeAnomalies.map((a, i) => (
              <AnomalyCard key={i} anomaly={a} />
            ))}
          </div>
        </div>
      )}
      {positiveAnomalies.length > 0 && (
        <div>
          <div className="text-xs font-medium text-green-600 mb-2">积极变化</div>
          <div className="space-y-2">
            {positiveAnomalies.map((a, i) => (
              <AnomalyCard key={i} anomaly={a} positive />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function AnomalyCard({ anomaly, positive }: { anomaly: Anomaly; positive?: boolean }) {
  const borderColor = positive ? 'border-green-200' : anomaly.severity === 'critical' ? 'border-red-300' : 'border-orange-200'
  const bgColor = positive ? 'bg-green-50/50' : anomaly.severity === 'critical' ? 'bg-red-50/50' : 'bg-orange-50/50'
  const icon = positive ? '🟢' : anomaly.severity === 'critical' ? '🔴' : '🟡'

  return (
    <div className={`border rounded-lg p-3 ${borderColor} ${bgColor}`}>
      <div className="flex items-start gap-2">
        <span>{icon}</span>
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-800">{anomaly.metric}</div>
          <div className="text-xs text-gray-600 mt-0.5">{anomaly.suggestion}</div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
            <span>Z-Score: {anomaly.zScore}</span>
            <span>当前值: {anomaly.value.toFixed(2)}</span>
            <span>历史均值: {anomaly.mean}</span>
          </div>
        </div>
        <Tag color={anomaly.severity === 'critical' ? 'red' : 'orange'} className="!text-xs">
          {anomaly.severity}
        </Tag>
      </div>
    </div>
  )
}

// ═══════════════ 信号健康度 ═══════════════

function SignalHealthSection({ report }: { report: SignalHealthReport }) {
  const healthLabel: Record<string, { text: string; color: string }> = {
    healthy: { text: '正常', color: 'green' },
    low_variance: { text: '区分度不足', color: 'orange' },
    high_variance: { text: '不稳定', color: 'orange' },
    saturated: { text: '饱和', color: 'red' },
  }

  const overallLabel: Record<string, { text: string; color: string }> = {
    healthy: { text: '全部健康', color: 'green' },
    acceptable: { text: '基本正常', color: 'blue' },
    needs_attention: { text: '需要关注', color: 'orange' },
    unknown: { text: '未知', color: 'default' },
    insufficient_data: { text: '数据不足', color: 'default' },
  }

  const columns = [
    {
      title: '信号名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <span className="font-medium">{name}</span>,
    },
    {
      title: '均值',
      dataIndex: 'mean',
      key: 'mean',
      width: 80,
      render: (v: number) => <span className="text-gray-700">{v.toFixed(3)}</span>,
    },
    {
      title: '标准差',
      dataIndex: 'stdDev',
      key: 'stdDev',
      width: 80,
      render: (v: number) => <span className="text-gray-500">{v.toFixed(3)}</span>,
    },
    {
      title: '样本数',
      dataIndex: 'sampleCount',
      key: 'sampleCount',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'health',
      key: 'health',
      width: 120,
      render: (health: string) => {
        const info = healthLabel[health] || { text: health, color: 'default' }
        return <Tag color={info.color}>{info.text}</Tag>
      },
    },
  ]

  const overall = overallLabel[report.overallHealth] || { text: '未知', color: 'default' }

  return (
    <Card
      title={
        <Space>
          <SafetyIcon />
          <span>信号健康度</span>
          <Tag color={overall.color}>{overall.text}</Tag>
        </Space>
      }
      size="small"
    >
      <Table
        dataSource={report.signals}
        columns={columns}
        rowKey="name"
        size="small"
        pagination={false}
      />
      {(report.signals?.filter(s => s.health === 'saturated')?.length ?? 0) > 0 && (
        <Alert
          type="warning"
          message="存在饱和信号"
          description="饱和信号总是接近 1.0，对决策贡献有限。建议调低其权重或引入更精细的计算逻辑。"
          showIcon
          className="mt-3"
        />
      )}
    </Card>
  )
}

function SafetyIcon() {
  return <span style={{ fontSize: '14px' }}>🛡️</span>
}

// ═══════════════ AutoFlow 指标 ═══════════════

function AutoFlowMetricsSection({ metrics }: { metrics: NonNullable<DigestData['autoFlowMetrics']> }) {
  return (
    <Card title={<Space><ThunderboltOutlined /><span>AutoFlow 自动放行</span></Space>} size="small">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-xl font-semibold text-gray-800">{metrics.totalEvaluations}</div>
          <div className="text-xs text-gray-500">评估次数</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-semibold text-green-600">{metrics.accuracy}%</div>
          <div className="text-xs text-gray-500">准确率</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-semibold text-orange-500">{metrics.falsePositiveRate}%</div>
          <div className="text-xs text-gray-500">误放率</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-semibold text-blue-600">~{metrics.savedReviewTime}min</div>
          <div className="text-xs text-gray-500">节省审核时间</div>
        </div>
      </div>
      {metrics.falsePositiveRate > 10 && (
        <Alert type="warning" message={`误放率较高 (${metrics.falsePositiveRate}%)，建议提高 confidenceThreshold`} showIcon className="mt-3" />
      )}
      {metrics.accuracy >= 95 && (
        <Alert type="success" message={`准确率优秀 (${metrics.accuracy}%)，可考虑降低阈值以提升自动化率`} showIcon className="mt-3" />
      )}
    </Card>
  )
}

// ═══════════════ 高频问题 ═══════════════

function TopIssuesSection({ issues }: { issues: DigestData['topIssues'] }) {
  const columns = [
    {
      title: '问题模式',
      dataIndex: 'pattern',
      key: 'pattern',
      render: (v: string) => <span className="font-medium text-gray-700">{v}</span>,
    },
    {
      title: '次数',
      dataIndex: 'count',
      key: 'count',
      width: 80,
      sorter: (a: any, b: any) => a.count - b.count,
    },
    {
      title: '严重度',
      dataIndex: 'severity',
      key: 'severity',
      width: 100,
      render: (v: string) => {
        const color = v === 'critical' ? 'red' : v === 'high' ? 'orange' : v === 'medium' ? 'blue' : 'default'
        return <Tag color={color}>{v}</Tag>
      },
    },
    {
      title: '建议',
      dataIndex: 'suggestion',
      key: 'suggestion',
      render: (v: string) => <span className="text-xs text-gray-500">{v}</span>,
    },
  ]

  return (
    <Card title={<Space><ExclamationCircleOutlined /><span>高频问题 TOP {issues.length}</span></Space>} size="small">
      <Table dataSource={issues} columns={columns} rowKey="pattern" size="small" pagination={false} />
    </Card>
  )
}

// ═══════════════ Agent 表现 ═══════════════

function AgentPerformanceSection({ data }: { data: DigestData['agentPerformance'] }) {
  const columns = [
    {
      title: 'Agent',
      dataIndex: 'agentId',
      key: 'agentId',
      render: (v: string) => <span className="font-medium">{v}</span>,
    },
    {
      title: '参与节点',
      dataIndex: 'runsParticipated',
      key: 'runsParticipated',
      width: 100,
    },
    {
      title: '一次通过率',
      dataIndex: 'firstPassRate',
      key: 'firstPassRate',
      width: 130,
      render: (v: number) => (
        <Progress
          percent={v}
          size="small"
          strokeColor={v >= 80 ? '#52c41a' : v >= 50 ? '#faad14' : '#ff4d4f'}
          format={() => `${v}%`}
        />
      ),
    },
    {
      title: '平均 Token',
      dataIndex: 'averageTokens',
      key: 'averageTokens',
      width: 100,
      render: (v: number) => <span className="text-gray-600">{formatNumber(v)}</span>,
    },
  ]

  return (
    <Card title="Agent 表现" size="small">
      <Table dataSource={data} columns={columns} rowKey="agentId" size="small" pagination={false} />
    </Card>
  )
}

// ═══════════════ 工具方法 ═══════════════

function formatDuration(ms: number): string {
  if (ms === 0) return '-'
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  if (minutes > 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function formatTrendValue(v: number, isPercent?: boolean, isDuration?: boolean): string {
  if (isDuration) return formatDuration(v)
  if (isPercent) return `${Math.round(v * 100)}%`
  return v >= 1000 ? formatNumber(v) : String(Math.round(v))
}
