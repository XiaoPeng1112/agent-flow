import { useState, useEffect, useCallback } from 'react'
import { Card, Tag, Empty, Spin, Alert, Statistic, Select, Badge } from 'antd'
import {
  AlertOutlined,
  MessageOutlined,
  ClusterOutlined,
  FireOutlined,
  FieldTimeOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons'
import {
  feedbackAggregateApi,
  type FeedbackAggregateSummary,
  type FeedbackCluster,
  type FeedbackUrgency,
} from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

// ─── 紧急度配置 ───
const URGENCY_CONFIG: Record<FeedbackUrgency, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  critical: { label: '紧急', color: 'error', bgColor: 'bg-red-50 border-red-200', icon: <FireOutlined className="text-red-500" /> },
  high: { label: '高', color: 'orange', bgColor: 'bg-orange-50 border-orange-200', icon: <AlertOutlined className="text-orange-500" /> },
  normal: { label: '普通', color: 'blue', bgColor: 'bg-blue-50 border-blue-200', icon: <MessageOutlined className="text-blue-500" /> },
  low: { label: '低', color: 'default', bgColor: 'bg-gray-50 border-gray-200', icon: <MessageOutlined className="text-gray-400" /> },
}

export function FeedbackAggregatePanel({ run }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<FeedbackAggregateSummary | null>(null)
  const [clusters, setClusters] = useState<FeedbackCluster[]>([])
  const [days, setDays] = useState(14)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await feedbackAggregateApi.getAggregate(days, run.id)
      setSummary(res.summary)
      setClusters(res.clusters)
    } catch (err: any) {
      setError(err.message || '加载反馈聚合数据失败')
    } finally {
      setLoading(false)
    }
  }, [run.id, days])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Spin size="large" tip="聚合反馈数据..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert type="warning" message="反馈聚合不可用" description={error} showIcon />
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* 汇总 + 时间范围选择 */}
      {summary && <AggregateSummaryCard summary={summary} days={days} onDaysChange={setDays} />}

      {/* 聚类列表 */}
      <ClusterList clusters={clusters} />
    </div>
  )
}

// ─── 汇总统计卡 ───

function AggregateSummaryCard({
  summary,
  days,
  onDaysChange,
}: {
  summary: FeedbackAggregateSummary
  days: number
  onDaysChange: (d: number) => void
}) {
  return (
    <Card size="small" className="!rounded-xl !border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClusterOutlined className="text-indigo-500" />
          <span className="text-[13px] font-semibold text-gray-800">反馈聚合分析</span>
        </div>
        <Select
          value={days}
          onChange={onDaysChange}
          size="small"
          className="!w-[100px]"
          options={[
            { value: 7, label: '最近 7 天' },
            { value: 14, label: '最近 14 天' },
            { value: 30, label: '最近 30 天' },
          ]}
        />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Statistic
          title={<span className="text-[11px] text-gray-400">总条目</span>}
          value={summary.totalEntries}
          valueStyle={{ fontSize: '20px', fontWeight: 600 }}
          className="!text-center"
        />
        <Statistic
          title={<span className="text-[11px] text-gray-400">聚类数</span>}
          value={summary.clusterCount}
          valueStyle={{ fontSize: '20px', fontWeight: 600, color: '#6366f1' }}
          className="!text-center"
        />
        <Statistic
          title={<span className="text-[11px] text-gray-400">紧急</span>}
          value={summary.criticalCount}
          valueStyle={{ fontSize: '20px', fontWeight: 600, color: '#ef4444' }}
          className="!text-center"
          prefix={<FireOutlined className="text-[14px]" />}
        />
        <Statistic
          title={<span className="text-[11px] text-gray-400">高优</span>}
          value={summary.highCount}
          valueStyle={{ fontSize: '20px', fontWeight: 600, color: '#f97316' }}
          className="!text-center"
          prefix={<AlertOutlined className="text-[14px]" />}
        />
      </div>
    </Card>
  )
}

// ─── 聚类列表 ───

function ClusterList({ clusters }: { clusters: FeedbackCluster[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  if (clusters.length === 0) {
    return (
      <Card size="small" className="!rounded-xl !border-gray-100">
        <Empty description="暂无反馈聚类数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    )
  }

  return (
    <Card
      size="small"
      className="!rounded-xl !border-gray-100"
      title={
        <span className="text-[13px] font-semibold text-gray-800">
          反馈聚类 ({clusters.length})
        </span>
      }
    >
      <div className="space-y-2">
        {clusters.map((cluster, idx) => {
          const isExpanded = expandedIdx === idx
          const urgencyConf = URGENCY_CONFIG[cluster.urgency]

          return (
            <div key={idx} className={`border rounded-lg overflow-hidden ${urgencyConf.bgColor}`}>
              {/* 聚类头 */}
              <div
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                {urgencyConf.icon}

                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-medium text-gray-700 truncate block">
                    {cluster.categoryLabel}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Tag color={urgencyConf.color} className="!text-[9px] !m-0 !px-1">
                      {urgencyConf.label}
                    </Tag>
                    <span className="text-[10px] text-gray-400">
                      严重度: {cluster.severity}
                    </span>
                  </div>
                </div>

                {/* 计数 */}
                <Badge
                  count={cluster.count}
                  style={{ backgroundColor: cluster.urgency === 'critical' ? '#ef4444' : cluster.urgency === 'high' ? '#f97316' : '#6b7280' }}
                />

                {/* 时间 */}
                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                  <FieldTimeOutlined />
                  {formatTimestamp(cluster.latestTimestamp)}
                </span>
              </div>

              {/* 展开详情 */}
              {isExpanded && (
                <ClusterDetailView cluster={cluster} />
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── 聚类详情视图 ───

function ClusterDetailView({ cluster }: { cluster: FeedbackCluster }) {
  return (
    <div className="px-4 py-3 bg-white/60 border-t border-gray-200 space-y-3">
      {/* Top Patterns */}
      {(cluster.topPatterns?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] text-gray-500 font-medium mb-1.5 flex items-center gap-1">
            <NodeIndexOutlined />
            常见模式
          </div>
          <div className="space-y-1">
            {cluster.topPatterns.map((pat, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-gray-100">
                <span className="text-[11px] text-gray-700 flex-1">{pat.pattern}</span>
                <Badge count={pat.count} size="small" style={{ backgroundColor: '#6b7280' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Affected Nodes */}
      {(cluster.affectedNodes?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] text-gray-500 font-medium mb-1.5">涉及节点</div>
          <div className="flex flex-wrap gap-1.5">
            {cluster.affectedNodes.map((nodeId) => (
              <Tag key={nodeId} className="!text-[10px] !m-0" color="processing">
                {nodeId}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 辅助 ───

function formatTimestamp(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}小时前`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}天前`
}
