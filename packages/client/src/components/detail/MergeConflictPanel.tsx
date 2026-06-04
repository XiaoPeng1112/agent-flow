import { useState, useEffect, useCallback } from 'react'
import { Card, Tag, Empty, Spin, Alert, Tooltip, Statistic, Badge } from 'antd'
import {
  WarningOutlined,
  FileExclamationOutlined,
  CheckCircleOutlined,
  BranchesOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import {
  mergeConflictApi,
  type MergeConflictSummary,
  type MergeConflictNodeEntry,
  type ConflictDetail,
  type ConflictSeverity,
} from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

// ─── 严重度颜色映射 ───
const SEVERITY_CONFIG: Record<ConflictSeverity, { label: string; color: string; bgColor: string; textColor: string }> = {
  none: { label: '无冲突', color: 'success', bgColor: 'bg-green-50', textColor: 'text-green-600' },
  low: { label: '低', color: 'default', bgColor: 'bg-gray-50', textColor: 'text-gray-600' },
  medium: { label: '中', color: 'warning', bgColor: 'bg-amber-50', textColor: 'text-amber-600' },
  high: { label: '高', color: 'orange', bgColor: 'bg-orange-50', textColor: 'text-orange-600' },
  critical: { label: '严重', color: 'error', bgColor: 'bg-red-50', textColor: 'text-red-600' },
}

// ─── 冲突类型映射 ───
const CONFLICT_TYPE_LABELS: Record<string, string> = {
  content: '内容冲突',
  'add/add': '双方新增',
  'modify/delete': '修改/删除',
  rename: '重命名冲突',
  unknown: '未知类型',
}

export function MergeConflictPanel({ run }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<MergeConflictSummary | null>(null)
  const [conflicts, setConflicts] = useState<MergeConflictNodeEntry[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await mergeConflictApi.getRunConflicts(run.id)
      setSummary(res.summary)
      setConflicts(res.conflicts)
    } catch (err: any) {
      setError(err.message || '加载合并冲突数据失败')
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
        <Spin size="large" tip="检测合并冲突..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert type="warning" message="冲突检测不可用" description={error} showIcon />
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* 汇总卡片 */}
      {summary && <ConflictSummaryCard summary={summary} />}

      {/* 冲突节点列表 */}
      <ConflictNodeList conflicts={conflicts} />
    </div>
  )
}

// ─── 汇总卡片 ───

function ConflictSummaryCard({ summary }: { summary: MergeConflictSummary }) {
  const isClean = summary.nodesWithConflicts === 0
  const worstSeverity = getSeverityFromScore(summary.worstSeverityScore)
  const severityConf = SEVERITY_CONFIG[worstSeverity]

  return (
    <Card size="small" className="!rounded-xl !border-gray-100">
      <div className="flex items-center gap-2 mb-4">
        <BranchesOutlined className={isClean ? 'text-green-500' : 'text-orange-500'} />
        <span className="text-[13px] font-semibold text-gray-800">合并冲突检测</span>
        {isClean && (
          <Tag color="success" className="!text-[10px] !ml-2">
            <CheckCircleOutlined /> 无冲突
          </Tag>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Statistic
          title={<span className="text-[11px] text-gray-400">冲突节点</span>}
          value={summary.nodesWithConflicts}
          valueStyle={{
            fontSize: '20px',
            fontWeight: 600,
            color: summary.nodesWithConflicts > 0 ? '#ef4444' : '#10b981',
          }}
          className="!text-center"
        />
        <Statistic
          title={<span className="text-[11px] text-gray-400">冲突文件</span>}
          value={summary.totalConflictFiles}
          valueStyle={{
            fontSize: '20px',
            fontWeight: 600,
            color: summary.totalConflictFiles > 0 ? '#f59e0b' : '#10b981',
          }}
          className="!text-center"
        />
        <div className="flex flex-col items-center justify-center">
          <span className="text-[11px] text-gray-400 mb-1">最严重程度</span>
          <Tag
            color={severityConf.color}
            className="!text-[12px] !px-3 !py-0.5"
          >
            {severityConf.label}
          </Tag>
        </div>
      </div>
    </Card>
  )
}

// ─── 冲突节点列表 ───

function ConflictNodeList({ conflicts }: { conflicts: MergeConflictNodeEntry[] }) {
  const [expandedNode, setExpandedNode] = useState<string | null>(null)

  // 按冲突状态分组：有冲突排前面
  const sorted = [...conflicts].sort((a, b) => {
    if (a.hasConflict && !b.hasConflict) return -1
    if (!a.hasConflict && b.hasConflict) return 1
    return b.severityScore - a.severityScore
  })

  if (sorted.length === 0) {
    return (
      <Card size="small" className="!rounded-xl !border-gray-100">
        <Empty description="暂无冲突检测记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    )
  }

  const conflictNodes = sorted.filter((c) => c.hasConflict)
  const cleanNodes = sorted.filter((c) => !c.hasConflict)

  return (
    <div className="space-y-4">
      {/* 有冲突的节点 */}
      {conflictNodes.length > 0 && (
        <Card
          size="small"
          className="!rounded-xl !border-red-100"
          title={
            <div className="flex items-center gap-2">
              <ExclamationCircleOutlined className="text-red-500" />
              <span className="text-[13px] font-semibold text-gray-800">
                存在冲突 ({conflictNodes.length})
              </span>
            </div>
          }
        >
          <div className="space-y-2">
            {conflictNodes.map((node) => {
              const isExpanded = expandedNode === node.nodeId
              const severity = node.severity as ConflictSeverity
              const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.medium

              return (
                <div key={node.nodeId} className={`border rounded-lg overflow-hidden ${config.bgColor} border-gray-200`}>
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setExpandedNode(isExpanded ? null : node.nodeId)}
                  >
                    <WarningOutlined className={config.textColor} />
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-medium text-gray-700 truncate block">
                        {node.nodeName}
                      </span>
                    </div>
                    <Tag color={config.color} className="!text-[10px] !m-0">
                      {config.label}
                    </Tag>
                    <Badge count={node.conflictFiles?.length ?? 0} size="small" />
                  </div>

                  {isExpanded && (
                    <ConflictFileList
                      conflictFiles={node.conflictFiles}
                      conflicts={node.conflicts}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* 无冲突的节点 */}
      {cleanNodes.length > 0 && (
        <Card
          size="small"
          className="!rounded-xl !border-gray-100"
          title={
            <div className="flex items-center gap-2">
              <CheckCircleOutlined className="text-green-500" />
              <span className="text-[13px] font-semibold text-gray-800">
                无冲突 ({cleanNodes.length})
              </span>
            </div>
          }
        >
          <div className="flex flex-wrap gap-2">
            {cleanNodes.map((node) => (
              <Tag key={node.nodeId} color="success" className="!text-[11px]">
                {node.nodeName}
              </Tag>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── 冲突文件展开视图 ───

function ConflictFileList({
  conflictFiles,
  conflicts,
}: {
  conflictFiles: string[]
  conflicts: ConflictDetail[]
}) {
  return (
    <div className="px-4 py-3 bg-white/50 border-t border-gray-200 space-y-1.5">
      <div className="text-[11px] text-gray-500 font-medium mb-2">
        冲突文件 ({conflictFiles?.length ?? 0})
      </div>
      {conflicts.map((conflict, idx) => (
        <div key={idx} className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-gray-100">
          <FileExclamationOutlined className="text-amber-500 text-[12px]" />
          <Tooltip title={conflict.filePath}>
            <span className="text-[11px] text-gray-700 truncate flex-1 font-mono">
              {conflict.filePath}
            </span>
          </Tooltip>
          <Tag color="default" className="!text-[9px] !m-0 !px-1">
            {CONFLICT_TYPE_LABELS[conflict.type] || conflict.type}
          </Tag>
        </div>
      ))}
    </div>
  )
}

// ─── 辅助函数 ───

function getSeverityFromScore(score: number): ConflictSeverity {
  if (score >= 0.8) return 'critical'
  if (score >= 0.6) return 'high'
  if (score >= 0.4) return 'medium'
  if (score > 0) return 'low'
  return 'none'
}
