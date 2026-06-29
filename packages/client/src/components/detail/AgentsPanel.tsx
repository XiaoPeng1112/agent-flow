import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, Tag, Button, Tooltip, Progress, Statistic, App, Empty, Badge, Switch, Input, Divider } from 'antd'
import {
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  HistoryOutlined,
  ApiOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import { agentApi, projectApi } from '../../api'
import type { AgentConfig, AgentTurn } from '../../types'

interface Props {
  project: { id: string; name: string; isDemo?: boolean }
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

  // 从后端拉取项目级别 Token 统计（单一 API 调用，无 N+1 问题）
  const [backendTokenStats, setBackendTokenStats] = useState<{
    totalInput: number; totalOutput: number; totalTokens: number;
    turnCount: number
  } | null>(null)

  const fetchTokenStats = useCallback(async () => {
    try {
      const stats = await projectApi.getStats(_project.id)
      if (stats.totalTokens > 0) {
        setBackendTokenStats({
          totalInput: stats.totalInputTokens,
          totalOutput: stats.totalOutputTokens,
          totalTokens: stats.totalTokens,
          turnCount: stats.completedNodes,
        })
      }
    } catch {
      // 静默失败
    }
  }, [_project.id])

  useEffect(() => {
    fetchTokenStats()
  }, [fetchTokenStats])

  // Token 统计：合并后端持久化数据 + 本次会话 WS 实时数据
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

  // 汇总统计：后端数据 + 实时数据
  const totalStats = useMemo(() => {
    // 实时 WS 数据
    let input = 0, output = 0, total = 0, turnCount = 0
    Object.values(tokenStats).forEach((s) => {
      input += s.input
      output += s.output
      total += s.total
      turnCount += s.turnCount
    })

    // 加上后端持久化数据
    if (backendTokenStats && backendTokenStats.totalTokens > 0) {
      input += backendTokenStats.totalInput
      output += backendTokenStats.totalOutput
      total += backendTokenStats.totalTokens
      turnCount += backendTokenStats.turnCount
    }

    return { input, output, total, turnCount }
  }, [tokenStats, backendTokenStats])

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

      {/* ★ 项目 Agent 可用性配置 */}
      <ProjectAgentConfig projectId={_project.id} agents={agents} isDemo={_project.isDemo} />

      {/* Agent 列表（按 category 分组） */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ApiOutlined className="text-gray-500" />
          <span className="text-[13px] font-medium text-gray-700">
            已注册 Agent ({agents.length})
          </span>
        </div>

        {/* Codex 系列 */}
        {agents.some(a => a.category === 'codex') && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[16px]">⚡</span>
              <span className="text-[12px] font-semibold text-gray-600 uppercase tracking-wide">OpenAI Codex</span>
              <Tag className="!text-[9px] !m-0 !bg-emerald-50 !text-emerald-600 !border-0">
                {agents.filter(a => a.category === 'codex').length} agents
              </Tag>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.filter(a => a.category === 'codex').map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  activeTurn={activeTurns.find((t) => t.agentId === agent.id)}
                  stats={tokenStats[agent.id]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Claude 系列 */}
        {agents.some(a => a.category === 'claude') && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[16px]">🤖</span>
              <span className="text-[12px] font-semibold text-gray-600 uppercase tracking-wide">Anthropic Claude</span>
              <Tag className="!text-[9px] !m-0 !bg-purple-50 !text-purple-600 !border-0">
                {agents.filter(a => a.category === 'claude').length} agents
              </Tag>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.filter(a => a.category === 'claude').map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  activeTurn={activeTurns.find((t) => t.agentId === agent.id)}
                  stats={tokenStats[agent.id]}
                />
              ))}
            </div>
          </div>
        )}

        {/* 自定义 CLI */}
        {agents.some(a => a.category === 'custom') && (
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[16px]">🔧</span>
              <span className="text-[12px] font-semibold text-gray-600 uppercase tracking-wide">Custom CLI</span>
              <Tag className="!text-[9px] !m-0 !bg-gray-100 !text-gray-600 !border-0">
                {agents.filter(a => a.category === 'custom').length} agents
              </Tag>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.filter(a => a.category === 'custom').map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  activeTurn={activeTurns.find((t) => t.agentId === agent.id)}
                  stats={tokenStats[agent.id]}
                />
              ))}
            </div>
          </div>
        )}
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

      {/* ★ Provider 配置面板（多 Provider Runtime Registry） */}
      <ProviderConfigPanel agents={agents} />
    </div>
  )
}

// ═══════════════ 项目 Agent 可用性配置面板 ═══════════════

function ProjectAgentConfig({ projectId, agents, isDemo = false }: { projectId: string; agents: AgentConfig[]; isDemo?: boolean }) {
  const { message } = App.useApp()
  const projects = useAppStore((s) => s.projects)
  const setProjects = useAppStore((s) => s.setProjects)
  const [enabledIds, setEnabledIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // 加载当前项目的 Agent 启用配置
  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await projectApi.getEnabledAgents(projectId)
      setEnabledIds(res.enabledAgentIds)
      setInitialized(true)
    } catch {
      // 默认全部启用
      setEnabledIds(agents.map(a => a.id))
      setInitialized(true)
    } finally {
      setLoading(false)
    }
  }, [projectId, agents])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // 切换某个 Agent 的启用状态
  const handleToggle = (agentId: string, checked: boolean) => {
    setEnabledIds(prev =>
      checked ? [...prev, agentId] : prev.filter(id => id !== agentId)
    )
  }

  // 保存配置
  const handleSave = async () => {
    setSaving(true)
    try {
      await projectApi.updateEnabledAgents(projectId, enabledIds)
      // 同步更新 store 中的项目数据，让其他组件（如 NodeDetailPanel）立即生效
      setProjects(projects.map(p =>
        p.id === projectId ? { ...p, enabledAgentIds: enabledIds } : p
      ))
      message.success('Agent 可用配置已保存')
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // 全选/全不选
  const handleSelectAll = () => setEnabledIds(agents.map(a => a.id))
  const handleDeselectAll = () => setEnabledIds([])

  const allEnabled = enabledIds.length === agents.length
  const noneEnabled = enabledIds.length === 0

  if (!initialized && loading) {
    return null
  }

  return (
    <Card
      className="!border-gray-200 !bg-white"
      styles={{ body: { padding: '20px 24px' } }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <LockOutlined className="text-amber-500" />
          <span className="text-[14px] font-medium text-gray-800">项目 Agent 可用配置</span>
          <Tag className="!text-[10px] !m-0 !bg-amber-50 !text-amber-600 !border-0">
            已启用 {enabledIds.length}/{agents.length}
          </Tag>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small"
            onClick={allEnabled ? handleDeselectAll : handleSelectAll}
            disabled={isDemo}
          >
            {allEnabled ? '全部取消' : '全部启用'}
          </Button>
          <Button
            type="primary"
            size="small"
            loading={saving}
            onClick={handleSave}
            disabled={isDemo}
          >
            保存
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mb-4">
        {isDemo
          ? '示范项目里这部分仅用于展示项目级 Agent 开关会如何影响执行面板。'
          : '配置本项目可以使用的 Agent。未购买 API Key 的 Agent 可在此处禁用，避免执行时报错。未配置时默认全部启用。'
        }
      </p>

      {noneEnabled && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
          <span className="text-[11px] text-red-600">⚠️ 当前没有启用任何 Agent，工作流将无法执行。请至少启用一个 Agent。</span>
        </div>
      )}

      <div className="space-y-4">
        {(['codex', 'claude', 'custom'] as const).map(cat => {
          const catAgents = agents.filter(a => a.category === cat)
          if (catAgents.length === 0) return null
          const catLabel = cat === 'codex' ? '⚡ OpenAI Codex' : cat === 'claude' ? '🤖 Anthropic Claude' : '🔧 Custom'
          return (
            <div key={cat}>
              <div className="text-[11px] font-medium text-gray-500 mb-2">{catLabel}</div>
              <div className="space-y-1.5">
                {catAgents.map((agent) => {
                  const isEnabled = enabledIds.includes(agent.id)
                  return (
                    <div
                      key={agent.id}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all ${
                        isEnabled
                          ? 'border-gray-100 bg-white hover:border-indigo-200'
                          : 'border-gray-100 bg-gray-50/50 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[14px] ${
                          isEnabled ? 'bg-indigo-50' : 'bg-gray-100'
                        }`}>
                          {agent.type === 'codex' ? '⚡' : agent.type === 'claude' ? '🤖' : '🔧'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium text-gray-800">{agent.name}</span>
                            <Tag color={agent.role === 'planner' ? 'purple' : agent.role === 'manager' ? 'blue' : 'green'} className="!text-[9px] !m-0 !px-1">
                              {agent.role}
                            </Tag>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {agent.description}
                            {agent.modelDescription && (
                              <span className="text-[9px] text-gray-300 ml-1">「{agent.modelDescription}」</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <Switch
                        size="small"
                        checked={isEnabled}
                        onChange={(checked) => handleToggle(agent.id, checked)}
                        disabled={isDemo}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ═══════════════ Provider 配置面板 ═══════════════

interface ProviderInfo {
  id: string
  name: string
  type: 'codex' | 'claude' | 'custom-cli'
  icon: string
  description: string
  envVars: { key: string; label: string; required: boolean }[]
  available: boolean
  agentCount: number
  defaultConfig: Record<string, string | number | boolean>
}

function ProviderConfigPanel({ agents }: { agents: AgentConfig[] }) {
  const { message } = App.useApp()
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [envValues, setEnvValues] = useState<Record<string, string>>({})

  // 基于已注册的 agents 推断 provider 信息
  const providers: ProviderInfo[] = useMemo(() => {
    const providerMap = new Map<string, ProviderInfo>()

    // 预定义 provider 配置
    const providerDefs: Record<string, Omit<ProviderInfo, 'available' | 'agentCount'>> = {
      codex: {
        id: 'codex',
        name: 'OpenAI Codex',
        type: 'codex',
        icon: '⚡',
        description: 'OpenAI Codex CLI — 高效代码生成与修改',
        envVars: [
          { key: 'OPENAI_API_KEY', label: 'API Key', required: true },
          { key: 'CODEX_MODEL', label: '默认模型', required: false },
          { key: 'CODEX_TIMEOUT', label: '超时时间(s)', required: false },
        ],
        defaultConfig: { model: 'codex-mini', timeout: 300, autoApprove: true },
      },
      claude: {
        id: 'claude',
        name: 'Anthropic Claude',
        type: 'claude',
        icon: '🤖',
        description: 'Claude Code CLI — 智能推理与代码分析',
        envVars: [
          { key: 'ANTHROPIC_API_KEY', label: 'API Key', required: true },
          { key: 'CLAUDE_MODEL', label: '默认模型', required: false },
          { key: 'CLAUDE_MAX_TOKENS', label: '最大 Tokens', required: false },
        ],
        defaultConfig: { model: 'claude-sonnet-4-20250514', maxTokens: 8192, dangerouslySkipPermissions: false },
      },
      'custom-cli': {
        id: 'custom-cli',
        name: '自定义 CLI',
        type: 'custom-cli',
        icon: '🔧',
        description: '自定义命令行 Agent — 支持任意 CLI 工具',
        envVars: [
          { key: 'CUSTOM_CLI_PATH', label: 'CLI 路径', required: true },
          { key: 'CUSTOM_CLI_ARGS', label: '默认参数', required: false },
        ],
        defaultConfig: { streamOutput: true },
      },
    }

    for (const agent of agents) {
      if (!providerMap.has(agent.type)) {
        const def = providerDefs[agent.type] || {
          id: agent.type,
          name: agent.type,
          type: agent.type as any,
          icon: '🔌',
          description: `${agent.type} Provider`,
          envVars: [],
          defaultConfig: {},
        }
        providerMap.set(agent.type, {
          ...def,
          available: false,
          agentCount: 0,
        })
      }
      const provider = providerMap.get(agent.type)!
      provider.agentCount++
      if (agent.available !== false) provider.available = true
    }

    return [...providerMap.values()]
  }, [agents])

  const handleSaveConfig = (providerId: string) => {
    // 模拟保存（实际会调用后端 API）
    message.success(`${providerId} 配置已保存`)
    setEditingProvider(null)
  }

  return (
    <Card
      className="!border-gray-200 !bg-white"
      styles={{ body: { padding: '20px 24px' } }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CloudServerOutlined className="text-indigo-500" />
          <span className="text-[14px] font-medium text-gray-800">Runtime Provider 配置</span>
          <Tag className="!text-[10px] !m-0 !bg-purple-50 !text-purple-600 !border-0">
            {providers.length} 个 Provider
          </Tag>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mb-4">
        配置 Agent 后端提供商的连接参数、默认模型和环境变量。对标 MRF §4.9 Runtime Registry。
      </p>

      <div className="space-y-3">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className={`border rounded-xl p-4 transition-all ${
              provider.available
                ? 'border-gray-200 hover:border-indigo-200 hover:shadow-sm'
                : 'border-red-100 bg-red-50/20'
            }`}
          >
            {/* Provider 头部 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-[18px] ${
                  provider.available ? 'bg-indigo-50' : 'bg-red-50'
                }`}>
                  {provider.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-gray-800">{provider.name}</span>
                    {provider.available ? (
                      <Tag color="success" className="!text-[9px] !m-0 !px-1 !leading-4">可用</Tag>
                    ) : (
                      <Tag color="error" className="!text-[9px] !m-0 !px-1 !leading-4">不可用</Tag>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{provider.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Tag className="!text-[10px] !m-0 !bg-gray-50 !border-gray-200">
                  {provider.agentCount} Agent
                </Tag>
                <Button
                  type="text"
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={() => setEditingProvider(editingProvider === provider.id ? null : provider.id)}
                  className="!text-gray-400 hover:!text-indigo-500"
                />
              </div>
            </div>

            {/* 默认配置预览 */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {Object.entries(provider.defaultConfig).map(([key, value]) => (
                <div key={key} className="flex items-center gap-1 px-2 py-0.5 bg-gray-50 rounded text-[10px]">
                  <span className="text-gray-400">{key}:</span>
                  <span className="text-gray-600 font-mono">{String(value)}</span>
                </div>
              ))}
            </div>

            {/* 展开的配置面板 */}
            {editingProvider === provider.id && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-1.5 mb-3">
                  <SafetyCertificateOutlined className="text-[12px] text-gray-400" />
                  <span className="text-[11px] font-medium text-gray-600">环境变量配置</span>
                </div>
                <div className="space-y-2">
                  {provider.envVars.map((envVar) => (
                    <div key={envVar.key} className="flex items-center gap-3">
                      <label className="text-[11px] text-gray-500 w-28 shrink-0 flex items-center gap-1">
                        {envVar.label}
                        {envVar.required && <span className="text-red-400">*</span>}
                      </label>
                      <Input
                        size="small"
                        placeholder={envVar.key}
                        value={envValues[`${provider.id}_${envVar.key}`] || ''}
                        onChange={(e) => setEnvValues({ ...envValues, [`${provider.id}_${envVar.key}`]: e.target.value })}
                        type={envVar.key.includes('KEY') ? 'password' : 'text'}
                        className="!text-[11px] font-mono"
                      />
                    </div>
                  ))}
                </div>

                <Divider className="!my-3" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500">启用 Provider</span>
                    <Switch size="small" defaultChecked={provider.available} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="small" onClick={() => setEditingProvider(null)}>
                      取消
                    </Button>
                    <Button type="primary" size="small" onClick={() => handleSaveConfig(provider.id)}>
                      保存配置
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
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
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Tag color={roleColors[agent.role] || 'default'} className="!text-[10px] !m-0 !px-1.5">
              {agent.role}
            </Tag>
            {agent.model && (
              <Tag className="!text-[10px] !m-0 !px-1.5 !bg-blue-50 !text-blue-600 !border-blue-100">
                {agent.model}
              </Tag>
            )}
            <Tooltip title={isAvailable ? `CLI: ${agent.cliPath}` : 'CLI 未找到'}>
              {isAvailable ? (
                <CheckCircleOutlined className="text-[12px] text-green-500" />
              ) : (
                <CloseCircleOutlined className="text-[12px] text-red-500" />
              )}
            </Tooltip>
          </div>

          {/* 描述 */}
          <p className="text-[11px] text-gray-400 mt-1.5 truncate">
            {agent.description}
            {agent.modelDescription && (
              <span className="text-[10px] text-gray-300 ml-1">「{agent.modelDescription}」</span>
            )}
          </p>

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
