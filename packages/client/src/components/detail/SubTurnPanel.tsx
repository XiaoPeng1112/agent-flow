import { useState, useEffect, useCallback, useMemo } from 'react'
import { Select, Tag, Empty, Badge, Tooltip, Collapse, Progress, Descriptions } from 'antd'
import {
  ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ClockCircleOutlined, LoadingOutlined, ExperimentOutlined,
  CodeOutlined, EyeOutlined, BugOutlined, SwapOutlined,
  ThunderboltOutlined, WarningOutlined,
} from '@ant-design/icons'
import { adversarialApi } from '../../api'
import type {
  Run, TaskNode, SubTurn, AdversarialSession,
  AdversarialResult, ReviewVerdict, SubTurnRole, AdversarialSessionStatus,
} from '../../types'

/**
 * SubTurnPanel — 节点内多 Agent 对抗循环可视化
 *
 * 展示：
 * 1. 节点选择器（选择要查看的节点）
 * 2. 会话概览：策略、轮次、最终结果、质量分
 * 3. Sub-Turn 时间线：按 round 分组展示 coder→reviewer→(fix) 循环
 * 4. 每个 Sub-Turn 的详情（prompt/output/verdict/feedback）
 */

interface Props {
  run: Run
}

// 角色配置
const roleConfig: Record<SubTurnRole, { label: string; color: string; icon: React.ReactNode }> = {
  coder: { label: 'Coder', color: 'blue', icon: <CodeOutlined /> },
  reviewer: { label: 'Reviewer', color: 'orange', icon: <EyeOutlined /> },
  tester: { label: 'Tester', color: 'purple', icon: <BugOutlined /> },
}

// verdict 配置
const verdictConfig: Record<ReviewVerdict, { label: string; color: string; icon: React.ReactNode }> = {
  approved: { label: '通过', color: '#10b981', icon: <CheckCircleOutlined /> },
  rejected: { label: '驳回', color: '#ef4444', icon: <CloseCircleOutlined /> },
  conditional: { label: '有条件通过', color: '#f59e0b', icon: <WarningOutlined /> },
}

// 会话状态配置
const sessionStatusConfig: Record<AdversarialSessionStatus, { label: string; color: string }> = {
  active: { label: '进行中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  max_rounds_exceeded: { label: '超过最大轮次', color: 'warning' },
}

export function SubTurnPanel({ run }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<AdversarialSession[]>([])
  const [loading, setLoading] = useState(false)

  // 节点选项
  const nodeOptions = useMemo(() =>
    run.nodes.map((n: TaskNode) => ({
      value: n.id,
      label: `${n.name} (${n.type})`,
    })),
    [run.nodes]
  )

  // 加载节点的对抗会话
  const fetchSessions = useCallback(async (nodeId: string) => {
    setLoading(true)
    try {
      const res = await adversarialApi.getSessions(run.id, nodeId)
      setSessions(res.sessions || [])
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [run.id])

  // 选择节点时加载数据
  useEffect(() => {
    if (selectedNodeId) {
      fetchSessions(selectedNodeId)
    } else {
      setSessions([])
    }
  }, [selectedNodeId, fetchSessions])

  // 自动选择第一个节点
  useEffect(() => {
    if (!selectedNodeId && run.nodes.length > 0) {
      setSelectedNodeId(run.nodes[0].id)
    }
  }, [run.nodes, selectedNodeId])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 头部：节点选择 + 刷新 */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 shrink-0">
        <ExperimentOutlined className="text-indigo-500" />
        <span className="text-sm font-medium text-gray-700">对抗审查</span>
        <Select
          size="small"
          placeholder="选择节点"
          value={selectedNodeId}
          onChange={setSelectedNodeId}
          options={nodeOptions}
          className="min-w-[200px]"
          allowClear
        />
        <button
          onClick={() => selectedNodeId && fetchSessions(selectedNodeId)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title="刷新"
        >
          <ReloadOutlined spin={loading} />
        </button>
        {sessions.length > 0 && (
          <Tag color="blue" className="ml-auto">{sessions.length} 次对抗会话</Tag>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!selectedNodeId ? (
          <Empty description="请选择一个节点查看对抗审查详情" className="mt-16" />
        ) : sessions.length === 0 && !loading ? (
          <Empty description="该节点暂无对抗审查记录" className="mt-16" />
        ) : (
          <div className="space-y-6">
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════ 会话卡片组件 ═══════════════

function SessionCard({ session }: { session: AdversarialSession }) {
  const statusCfg = sessionStatusConfig[session.status]
  const duration = session.completedAt
    ? ((session.completedAt - session.startedAt) / 1000).toFixed(1)
    : null

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      {/* 会话头部 */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
        <SwapOutlined className="text-indigo-500" />
        <span className="text-xs font-medium text-gray-700">
          对抗会话
        </span>
        <Tag color={statusCfg.color} className="text-[10px]">{statusCfg.label}</Tag>
        <Tag className="text-[10px]">策略: {session.strategy.replace(/_/g, ' → ')}</Tag>
        <Tag className="text-[10px]">
          轮次: {session.currentRound + 1}/{session.maxRounds}
        </Tag>
        {duration && (
          <span className="text-[10px] text-gray-400 ml-auto">
            <ClockCircleOutlined className="mr-1" />{duration}s
          </span>
        )}
      </div>

      {/* 对抗结果概览 */}
      {session.result && (
        <ResultSummary result={session.result} />
      )}

      {/* Sub-Turn 时间线 */}
      <div className="px-4 py-3">
        <RoundTimeline subTurns={session.subTurns} maxRounds={session.maxRounds} />
      </div>
    </div>
  )
}

// ═══════════════ 结果摘要 ═══════════════

function ResultSummary({ result }: { result: AdversarialResult }) {
  const verdictCfg = verdictConfig[result.finalVerdict]
  const scorePercent = Math.round(result.qualityScore * 100)

  return (
    <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
      <Descriptions size="small" column={4} className="text-[11px]">
        <Descriptions.Item label="最终结论">
          <span style={{ color: verdictCfg.color }} className="font-medium">
            {verdictCfg.icon} {verdictCfg.label}
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="质量分">
          <Progress
            percent={scorePercent}
            size="small"
            strokeColor={scorePercent >= 80 ? '#10b981' : scorePercent >= 60 ? '#f59e0b' : '#ef4444'}
            className="w-24 inline-block"
            format={(p) => `${p}%`}
          />
        </Descriptions.Item>
        <Descriptions.Item label="总轮次">{result.totalRounds}</Descriptions.Item>
        <Descriptions.Item label="是否通过">
          {result.passed
            ? <Badge status="success" text="通过" />
            : <Badge status="error" text="未通过" />
          }
        </Descriptions.Item>
      </Descriptions>
      {result.summary && (
        <p className="text-[11px] text-gray-500 mt-1 mb-0">{result.summary}</p>
      )}
    </div>
  )
}

// ═══════════════ 按 Round 分组的 Sub-Turn 时间线 ═══════════════

function RoundTimeline({ subTurns }: { subTurns: SubTurn[]; maxRounds: number }) {
  // 按 roundIndex 分组
  const rounds = useMemo(() => {
    const grouped: Record<number, SubTurn[]> = {}
    for (const st of subTurns) {
      if (!grouped[st.roundIndex]) grouped[st.roundIndex] = []
      grouped[st.roundIndex].push(st)
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([idx, turns]) => ({ roundIndex: Number(idx), turns }))
  }, [subTurns])

  if (rounds.length === 0) {
    return <p className="text-[11px] text-gray-400">暂无 Sub-Turn 记录</p>
  }

  const collapseItems = rounds.map(({ roundIndex, turns }) => {
    // 该轮的 reviewer verdict
    const reviewerTurn = turns.find(t => t.role === 'reviewer')
    const verdict = reviewerTurn?.verdict
    const verdictCfg = verdict ? verdictConfig[verdict] : null

    return {
      key: String(roundIndex),
      label: (
        <div className="flex items-center gap-2">
          <ThunderboltOutlined className="text-indigo-400" />
          <span className="text-xs font-medium">Round {roundIndex + 1}</span>
          {verdictCfg && (
            <Tag color={verdict === 'approved' ? 'success' : verdict === 'rejected' ? 'error' : 'warning'} className="text-[10px]">
              {verdictCfg.icon} {verdictCfg.label}
            </Tag>
          )}
          <span className="text-[10px] text-gray-400">
            {turns.length} 个 Sub-Turn
          </span>
        </div>
      ),
      children: (
        <div className="space-y-3 pl-2">
          {turns
            .sort((a, b) => a.startedAt - b.startedAt)
            .map((st) => (
              <SubTurnCard key={st.id} subTurn={st} />
            ))}
        </div>
      ),
    }
  })

  return (
    <Collapse
      items={collapseItems}
      defaultActiveKey={rounds.map(r => String(r.roundIndex))}
      size="small"
      className="bg-transparent border-none [&_.ant-collapse-item]:border-gray-100"
    />
  )
}

// ═══════════════ 单个 Sub-Turn 卡片 ═══════════════

function SubTurnCard({ subTurn }: { subTurn: SubTurn }) {
  const roleCfg = roleConfig[subTurn.role]
  const duration = subTurn.completedAt
    ? ((subTurn.completedAt - subTurn.startedAt) / 1000).toFixed(1)
    : null

  const statusIcon = subTurn.status === 'running'
    ? <LoadingOutlined spin className="text-amber-500" />
    : subTurn.status === 'completed'
    ? <CheckCircleOutlined className="text-green-500" />
    : subTurn.status === 'failed'
    ? <CloseCircleOutlined className="text-red-500" />
    : <ClockCircleOutlined className="text-gray-400" />

  return (
    <div className="border border-gray-100 rounded-lg p-3 bg-gray-50/50">
      {/* Sub-Turn 头部 */}
      <div className="flex items-center gap-2 mb-2">
        {statusIcon}
        <Tag color={roleCfg.color} className="text-[10px]">
          {roleCfg.icon} {roleCfg.label}
        </Tag>
        {subTurn.verdict && (
          <Tag
            color={subTurn.verdict === 'approved' ? 'success' : subTurn.verdict === 'rejected' ? 'error' : 'warning'}
            className="text-[10px]"
          >
            {verdictConfig[subTurn.verdict].label}
          </Tag>
        )}
        {duration && (
          <span className="text-[10px] text-gray-400 ml-auto">{duration}s</span>
        )}
        {subTurn.tokenUsage && (
          <Tooltip title={`输入: ${subTurn.tokenUsage.input} / 输出: ${subTurn.tokenUsage.output}`}>
            <span className="text-[10px] text-gray-400">
              {subTurn.tokenUsage.total} tokens
            </span>
          </Tooltip>
        )}
      </div>

      {/* Prompt 摘要 */}
      {subTurn.prompt && (
        <div className="mb-2">
          <p className="text-[10px] text-gray-400 mb-0.5">Prompt:</p>
          <p className="text-[11px] text-gray-600 mb-0 line-clamp-2 bg-white px-2 py-1 rounded border border-gray-100">
            {subTurn.prompt.slice(0, 200)}{subTurn.prompt.length > 200 ? '...' : ''}
          </p>
        </div>
      )}

      {/* Output 摘要 */}
      {subTurn.output && (
        <div className="mb-2">
          <p className="text-[10px] text-gray-400 mb-0.5">Output:</p>
          <pre className="text-[11px] text-gray-700 mb-0 line-clamp-4 bg-white px-2 py-1 rounded border border-gray-100 whitespace-pre-wrap font-mono">
            {subTurn.output.slice(0, 500)}{subTurn.output.length > 500 ? '...' : ''}
          </pre>
        </div>
      )}

      {/* Review Feedback */}
      {subTurn.reviewFeedback && subTurn.reviewFeedback.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 mb-0.5">审查反馈:</p>
          <ul className="text-[11px] text-gray-600 mb-0 pl-4 space-y-0.5">
            {subTurn.reviewFeedback.map((fb, i) => (
              <li key={i} className="list-disc">{fb}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
