import { useState, useEffect, useCallback } from 'react'
import { Card, Tag, Progress, Table, Empty, Spin, Alert, Tooltip, Button, Statistic } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SafetyOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
  CodeOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import {
  validationApi,
  type ValidationSummary,
  type ValidationNodeResult,
  type ValidationResult,
  type ValidationDetail,
} from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

// ─── Strategy 标签颜色 ───
const STRATEGY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  script: { label: '脚本验证', color: 'cyan', icon: <CodeOutlined /> },
  contract: { label: '契约验证', color: 'purple', icon: <FileTextOutlined /> },
  llm: { label: 'LLM 验证', color: 'blue', icon: <ExperimentOutlined /> },
  composite: { label: '组合验证', color: 'geekblue', icon: <ThunderboltOutlined /> },
  skipped: { label: '已跳过', color: 'default', icon: <SafetyOutlined /> },
}

export function ValidationTurnPanel({ run }: Props) {
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ValidationSummary | null>(null)
  const [results, setResults] = useState<ValidationNodeResult[]>([])
  const [triggeringNode, setTriggeringNode] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await validationApi.getRunSummary(run.id)
      setSummary(res.summary)
      setResults(res.results)
    } catch (err: any) {
      setError(err.message || '加载验证数据失败')
    } finally {
      setLoading(false); setHasLoaded(true)
    }
  }, [run.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleTrigger = async (nodeId: string) => {
    setTriggeringNode(nodeId)
    try {
      const res = await validationApi.triggerValidation(run.id, nodeId)
      // 更新本地结果
      setResults((prev) =>
        prev.map((r) => (r.nodeId === nodeId ? { ...r, result: res.result } : r))
      )
      // 重新获取汇总
      const summaryRes = await validationApi.getRunSummary(run.id)
      setSummary(summaryRes.summary)
      setResults(summaryRes.results.map(row => row.nodeId === nodeId ? { ...row, result: res.result } : row))
    } catch (err: any) {
      setError(err.message || '触发验证失败，请重试')
    } finally {
      setTriggeringNode(null)
    }
  }

  if (loading && !hasLoaded) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Spin size="large" tip="加载验证数据..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert type="warning" message="验证请求失败" description={error} showIcon action={<Button onClick={fetchData}>重试</Button>} />
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* 汇总统计 */}
      {summary && <SummarySection summary={summary} />}

      {/* 节点验证结果列表 */}
      <NodeResultsSection
        results={results}
        triggeringNode={triggeringNode}
        onTrigger={handleTrigger}
        onRefresh={fetchData}
      />
    </div>
  )
}

// ─── 汇总统计区 ───

function SummarySection({ summary }: { summary: ValidationSummary }) {
  const passRate = summary.totalValidated > 0
    ? Math.round((summary.passed / summary.totalValidated) * 100)
    : 0

  return (
    <Card size="small" className="!rounded-xl !border-gray-100">
      <div className="flex items-center gap-2 mb-4">
        <SafetyOutlined className="text-indigo-500" />
        <span className="text-[13px] font-semibold text-gray-800">验证总览</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Statistic
          title={<span className="text-[11px] text-gray-400">已验证</span>}
          value={summary.totalValidated}
          className="!text-center"
          valueStyle={{ fontSize: '20px', fontWeight: 600 }}
        />
        <Statistic
          title={<span className="text-[11px] text-gray-400">通过</span>}
          value={summary.passed}
          valueStyle={{ fontSize: '20px', fontWeight: 600, color: '#10b981' }}
          className="!text-center"
        />
        <Statistic
          title={<span className="text-[11px] text-gray-400">失败</span>}
          value={summary.failed}
          valueStyle={{ fontSize: '20px', fontWeight: 600, color: '#ef4444' }}
          className="!text-center"
        />
        <div className="flex flex-col items-center justify-center">
          <span className="text-[11px] text-gray-400 mb-1">平均分</span>
          <Progress
            type="circle"
            size={52}
            percent={Math.round(summary.averageScore * 100)}
            format={(p) => `${p}`}
            strokeColor={summary.averageScore >= 0.8 ? '#10b981' : summary.averageScore >= 0.6 ? '#f59e0b' : '#ef4444'}
          />
        </div>
      </div>

      {/* 通过率进度条 */}
      <div className="mt-4 pt-3 border-t border-gray-50">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
          <span>通过率</span>
          <span className="font-medium">{passRate}%</span>
        </div>
        <Progress
          percent={passRate}
          showInfo={false}
          strokeColor={passRate >= 80 ? '#10b981' : passRate >= 60 ? '#f59e0b' : '#ef4444'}
          size="small"
        />
      </div>
    </Card>
  )
}

// ─── 节点验证结果列表 ───

function NodeResultsSection({
  results,
  triggeringNode,
  onTrigger,
  onRefresh,
}: {
  results: ValidationNodeResult[]
  triggeringNode: string | null
  onTrigger: (nodeId: string) => void
  onRefresh: () => void
}) {
  const [expandedNode, setExpandedNode] = useState<string | null>(null)

  if (results.length === 0) {
    return (
      <Card size="small" className="!rounded-xl !border-gray-100">
        <Empty description="暂无验证结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    )
  }

  return (
    <Card
      size="small"
      className="!rounded-xl !border-gray-100"
      title={
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-800">节点验证详情</span>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={onRefresh}
            className="!text-gray-400 hover:!text-indigo-500"
          />
        </div>
      }
    >
      <div className="space-y-2">
        {results.map((item) => {
          const isExpanded = expandedNode === item.nodeId
          const strategy = item.result?.strategy || 'skipped'
          const config = STRATEGY_CONFIG[strategy] || STRATEGY_CONFIG.skipped

          return (
            <div key={item.nodeId} className="border border-gray-100 rounded-lg overflow-hidden">
              {/* 节点行 */}
              <div
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50/50 transition-colors"
                onClick={() => setExpandedNode(isExpanded ? null : item.nodeId)}
              >
                {/* 状态 icon */}
                {item.result ? (
                  item.result.passed ? (
                    <CheckCircleOutlined className="text-green-500 text-[14px]" />
                  ) : (
                    <CloseCircleOutlined className="text-red-500 text-[14px]" />
                  )
                ) : (
                  <SafetyOutlined className="text-gray-300 text-[14px]" />
                )}

                {/* 节点名称 */}
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-medium text-gray-700 truncate block">
                    {item.nodeName}
                  </span>
                  <span className="text-[10px] text-gray-400">{item.nodeType}</span>
                </div>

                {/* 策略 Tag */}
                <Tag color={config.color} className="!text-[10px] !m-0">
                  {config.icon} {item.result ? config.label : '未验证或证据过期'}
                </Tag>

                {/* 分数 */}
                {item.result && (
                  <span className={`text-[12px] font-semibold ${
                    item.result.score >= 0.8 ? 'text-green-600' :
                    item.result.score >= 0.6 ? 'text-amber-600' : 'text-red-600'
                  }`}>
                    {Math.round(item.result.score * 100)}
                  </span>
                )}

                {/* 触发按钮 */}
                <Button
                  type="text"
                  size="small"
                  icon={<ThunderboltOutlined />}
                  loading={triggeringNode === item.nodeId}
                  onClick={(e) => { e.stopPropagation(); onTrigger(item.nodeId) }}
                  className="!text-indigo-400 hover:!text-indigo-600 !px-1.5"
                  title="手动触发验证"
                />
              </div>

              {/* 展开的详情 */}
              {isExpanded && item.result && (
                <ValidationDetailView result={item.result} />
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── 验证详情展开视图 ───

function ValidationDetailView({ result }: { result: ValidationResult }) {
  return (
    <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100 space-y-3">
      {/* 摘要 */}
      <div className="text-[11px] text-gray-600 leading-relaxed">
        {result.summary}
      </div>

      {/* 耗时 */}
      <div className="text-[10px] text-gray-400">
        耗时: {result.duration}ms
      </div>

      {/* 详情列表 */}
      {(result.details?.length ?? 0) > 0 && (
        <Table
          dataSource={result.details}
          rowKey="name"
          size="small"
          pagination={false}
          className="validation-detail-table"
          columns={[
            {
              title: '检查项',
              dataIndex: 'name',
              key: 'name',
              render: (name: string) => (
                <span className="text-[11px] text-gray-700 font-medium">{name}</span>
              ),
            },
            {
              title: '结果',
              dataIndex: 'passed',
              key: 'passed',
              width: 60,
              render: (passed: boolean) => (
                passed
                  ? <Tag color="success" className="!text-[10px] !m-0">通过</Tag>
                  : <Tag color="error" className="!text-[10px] !m-0">失败</Tag>
              ),
            },
            {
              title: '得分',
              dataIndex: 'score',
              key: 'score',
              width: 60,
              render: (score: number) => (
                <span className={`text-[11px] font-medium ${
                  score >= 0.8 ? 'text-green-600' : score >= 0.6 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {Math.round(score * 100)}
                </span>
              ),
            },
            {
              title: '输出',
              dataIndex: 'output',
              key: 'output',
              ellipsis: true,
              render: (output: string, record: ValidationDetail) => (
                <Tooltip title={record.error || output}>
                  <span className={`text-[10px] ${record.error ? 'text-red-500' : 'text-gray-500'}`}>
                    {record.error || output || '-'}
                  </span>
                </Tooltip>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
