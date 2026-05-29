import { useState, useEffect, useMemo } from 'react'
import { Card, Tag, Button, Tooltip, Progress, Statistic, App, Empty, Badge } from 'antd'
import {
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  HistoryOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import { agentApi } from '../../api'
import type { AgentConfig, AgentTurn } from '../../types'

interface Props {
  project: { id: string; name: string }
}

export function AgentsPanel({ project: _project }: Props) {
  const agents = useAppStore((s) => s.agents)
  const setAgents = useAppStore((s) => s.setAgents)
  const activeTurns = useAppStore((s) => s.activeTurns)
  const { message } = App.useApp()
  const [refreshing, setRefreshing] = useState(false)
  const [turnHistory, setTurnHistory] = useState<AgentTurn[]>([])

  // 刷新 Agent 可用性状态
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await agentApi.getStatus()
      setAgents(res.agents)
      message.success('Agent 状态已刷新')
    } catch (err: any) {
      message.error(`刷新失败: ${err.message}`)
    } finally {
      setRefreshing(false)
    }
  }

  // Token 统计（从 WebSocket 事件中收集的 activeTurns 完成后的 tokenUsage）
  const tokenStats = useMemo(() => {
    const stats: Record<string, { input: number; output: number; total: number; turnCount: number }> = {}

    // 初始化所有 agent
    agents.forEach((a) => {
      stats[a.id] = { input: 0, output: 0, total: 0, turnCount: 0 }
    })

    // 从 turnHistory（通过 WS 收集的已完成 turns）汇总
    turnHistory.forEach((turn) => {
      if (turn.tokenUsage && stats[turn.agentId]) {
        stats[turn.agentId].input += turn.tokenUsage.input
        stats[turn.agentId].output += turn.tokenUsage.output
        stats[turn.agentId].total += turn.tokenUsage.total
        stats[turn.agentId].turnCount += 1
      }
    })

    return stats
  }, [agents, turnHistory])

  // 汇总统计
  const totalStats = useMemo(() => {
    let input = 0, output = 0, total = 0, turnCount = 0
    Object.values(tokenStats).forEach((s) => {
      input += s.input
      output += s.output
      total += s.total
      turnCount += s.turnCount
    })
    return { input, output, total, turnCount }
  }, [tokenStats])

  // 监听 store 中完成的 turn（从 WS 收到 turn_completed 时记录）
  useEffect(() => {
    // 订阅 store 变化：当 activeTurn 被 remove 时，说明已完成
    const unsub = useAppStore.subscribe((state, prevState) => {
      // 找到被移除的 turns
      const removed = prevState.activeTurns.filter(
        (t) => !state.activeTurns.find((st) => st.id === t.id)
      )
      if (removed.length > 0) {
        setTurnHistory((prev) => [...prev, ...removed])
      }
    })
    return unsub
  }, [])

  return (
    <div className="flex flex-col gap-5">
      {/* 头部标题 + 刷新按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[16px] font-semibold text-gray-900 flex items-center gap-2">
            <RobotOutlined className="text-indigo-500" />
            Agent 管理
          </h3>
          <p className="text-[12px] text-gray-400 mt-0.5">
            管理和监控 Agent 状态、查看 Token 消耗统计
          </p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={refreshing}
          size="small"
        >
          刷新状态
        </Button>
      </div>

      {/* Token 统计总览 */}
      <Card
        className="!border-gray-200 !bg-white"
        styles={{ body: { padding: '20px 24px' } }}
      >
        <div className="flex items-center gap-2 mb-4">
          <DashboardOutlined className="text-indigo-500" />
          <span className="text-[14px] font-medium text-gray-800">Token 消耗总览</span>
          <Tag className="!text-[10px] !m-0 !bg-blue-50 !text-blue-600 !border-0">本次会话</Tag>
        </div>

        {totalStats.turnCount === 0 ? (
          <div className="text-center py-6">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="text-[12px] text-gray-400">
                  暂无 Token 消耗数据，执行 Agent 后数据将自动统计
                </span>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            <Statistic
              title={<span className="text-[11px]">总 Tokens</span>}
              value={totalStats.total}
              valueStyle={{ fontSize: 20, fontWeight: 600, color: '#6366f1' }}
              suffix={<span className="text-[11px] text-gray-400">tokens</span>}
            />
            <Statistic
              title={<span className="text-[11px]">输入 Tokens</span>}
              value={totalStats.input}
              valueStyle={{ fontSize: 20, fontWeight: 600, color: '#10b981' }}
            />
            <Statistic
              title={<span className="text-[11px]">输出 Tokens</span>}
              value={totalStats.output}
              valueStyle={{ fontSize: 20, fontWeight: 600, color: '#f59e0b' }}
            />
            <Statistic
              title={<span className="text-[11px]">执行次数</span>}
              value={totalStats.turnCount}
              valueStyle={{ fontSize: 20, fontWeight: 600, color: '#6b7280' }}
              suffix={<span className="text-[11px] text-gray-400">turns</span>}
            />
          </div>
        )}
      </Card>

      {/* Agent 列表 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ApiOutlined className="text-gray-500" />
          <span className="text-[13px] font-medium text-gray-700">
            已注册 Agent ({agents.length})
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              activeTurn={activeTurns.find((t) => t.agentId === agent.id)}
              stats={tokenStats[agent.id]}
            />
          ))}
        </div>
      </div>

      {/* 最近执行历史 */}
      {turnHistory.length > 0 && (
        <Card
          className="!border-gray-200 !bg-white"
          styles={{ body: { padding: '16px 20px' } }}
        >
          <div className="flex items-center gap-2 mb-3">
            <HistoryOutlined className="text-gray-500" />
            <span className="text-[13px] font-medium text-gray-700">
              最近执行 ({turnHistory.length})
            </span>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {[...turnHistory].reverse().slice(0, 20).map((turn) => (
              <div
                key={turn.id}
                className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg"
              >
                <Tag
                  color={turn.result === 'succeeded' ? 'success' : turn.result === 'failed' ? 'error' : 'warning'}
                  className="!text-[10px] !m-0"
                >
                  {turn.result || 'unknown'}
                </Tag>
                <span className="text-[12px] text-gray-700 font-medium">{turn.agentId}</span>
                <span className="text-[11px] text-gray-400 flex-1 truncate">
                  Turn #{turn.turnIndex}
                </span>
                {turn.tokenUsage && (
                  <span className="text-[11px] text-indigo-500 font-mono">
                    {turn.tokenUsage.total.toLocaleString()} tokens
                  </span>
                )}
                <span className="text-[10px] text-gray-400">
                  {turn.completedAt
                    ? `${Math.round((turn.completedAt - turn.startedAt) / 1000)}s`
                    : '-'
                  }
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ═══════════════ Agent 卡片 ═══════════════

function AgentCard({ agent, activeTurn, stats }: {
  agent: AgentConfig
  activeTurn?: AgentTurn
  stats?: { input: number; output: number; total: number; turnCount: number }
}) {
  const isRunning = !!activeTurn
  const isAvailable = agent.available !== false

  const roleColors: Record<string, string> = {
    planner: 'purple',
    manager: 'blue',
    executor: 'green',
  }

  const typeIcons: Record<string, string> = {
    claude: '🤖',
    codex: '⚡',
    'custom-cli': '🔧',
  }

  return (
    <Card
      className={`!shadow-sm transition-all ${
        isRunning
          ? '!border-amber-200 !bg-amber-50/30'
          : isAvailable
            ? '!border-gray-100 hover:!border-indigo-200 hover:!shadow-md'
            : '!border-red-100 !bg-red-50/30'
      }`}
      styles={{ body: { padding: '16px' } }}
    >
      <div className="flex items-start gap-3">
        {/* Agent 图标 */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[18px] shrink-0 ${
          isAvailable ? 'bg-indigo-50' : 'bg-red-50'
        }`}>
          {typeIcons[agent.type] || '🤖'}
        </div>

        <div className="flex-1 min-w-0">
          {/* 名称 + 状态 */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-800 truncate">{agent.name}</span>
            {isRunning && (
              <Badge status="processing" text={<span className="text-[10px] text-amber-600">执行中</span>} />
            )}
          </div>

          {/* 标签行 */}
          <div className="flex items-center gap-1.5 mt-1">
            <Tag color={roleColors[agent.role] || 'default'} className="!text-[10px] !m-0 !px-1.5">
              {agent.role}
            </Tag>
            <Tag className="!text-[10px] !m-0 !px-1.5 !bg-gray-50 !border-gray-200">
              {agent.type}
            </Tag>
            <Tooltip title={isAvailable ? `CLI: ${agent.cliPath}` : 'CLI 未找到'}>
              {isAvailable ? (
                <CheckCircleOutlined className="text-[12px] text-green-500" />
              ) : (
                <CloseCircleOutlined className="text-[12px] text-red-500" />
              )}
            </Tooltip>
          </div>

          {/* 描述 */}
          <p className="text-[11px] text-gray-400 mt-1.5 truncate">{agent.description}</p>

          {/* Token 使用统计（如果有） */}
          {stats && stats.turnCount > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">
                  已执行 {stats.turnCount} 次
                </span>
                <span className="text-[11px] text-indigo-600 font-mono font-medium">
                  {stats.total.toLocaleString()} tokens
                </span>
              </div>
              <div className="mt-1">
                <Progress
                  percent={stats.total > 0 ? Math.round((stats.output / stats.total) * 100) : 0}
                  size="small"
                  strokeColor={{ '0%': '#10b981', '100%': '#f59e0b' }}
                  format={() => (
                    <span className="text-[9px] text-gray-400">
                      输入{Math.round((stats.input / stats.total) * 100)}% / 输出{Math.round((stats.output / stats.total) * 100)}%
                    </span>
                  )}
                />
              </div>
            </div>
          )}

          {/* 执行中显示输出长度 */}
          {isRunning && activeTurn && (
            <div className="mt-2 pt-2 border-t border-amber-100">
              <div className="flex items-center gap-1.5">
                <ThunderboltOutlined className="text-[11px] text-amber-500 animate-pulse" />
                <span className="text-[10px] text-amber-600">
                  正在执行 · 已输出 {activeTurn.output.length} 字符 · {Math.round((Date.now() - activeTurn.startedAt) / 1000)}s
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
