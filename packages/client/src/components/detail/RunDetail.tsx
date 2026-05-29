import { useState, useEffect, useRef } from 'react'
import { Button, Tag, Card, Select, Input, Space, Tooltip, Popconfirm, App, Alert } from 'antd'
import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  SendOutlined,
  UndoOutlined,
  StepForwardOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  StopOutlined,
  LoadingOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import { runApi, nodeApi, agentApi } from '../../api'
import type { Run, TaskNode, TaskNodeStatus, AgentConfig, AgentTurn } from '../../types'

interface Props {
  run: Run
  onBack: () => void
}

const nodeStatusConfig: Record<TaskNodeStatus, {
  color: string
  bgColor: string
  borderColor: string
  icon: React.ReactNode
  label: string
  tagColor: string
}> = {
  pending: { color: '#9ca3af', bgColor: '#f9fafb', borderColor: '#e5e7eb', icon: <ClockCircleOutlined />, label: '等待中', tagColor: 'default' },
  ready: { color: '#3b82f6', bgColor: '#eff6ff', borderColor: '#bfdbfe', icon: <PlayCircleOutlined />, label: '就绪', tagColor: 'blue' },
  running: { color: '#f59e0b', bgColor: '#fffbeb', borderColor: '#fde68a', icon: <ThunderboltOutlined />, label: '执行中', tagColor: 'warning' },
  wait_user_review: { color: '#f97316', bgColor: '#fff7ed', borderColor: '#fed7aa', icon: <EyeOutlined />, label: '待验收', tagColor: 'orange' },
  completed: { color: '#10b981', bgColor: '#ecfdf5', borderColor: '#a7f3d0', icon: <CheckCircleOutlined />, label: '已完成', tagColor: 'success' },
  failed: { color: '#ef4444', bgColor: '#fef2f2', borderColor: '#fecaca', icon: <CloseCircleOutlined />, label: '失败', tagColor: 'error' },
  skipped: { color: '#9ca3af', bgColor: '#f9fafb', borderColor: '#e5e7eb', icon: <StepForwardOutlined />, label: '已跳过', tagColor: 'default' },
}

const roleConfig: Record<string, { label: string; color: string }> = {
  planner: { label: '规划者', color: 'purple' },
  manager: { label: '管理者', color: 'blue' },
  executor: { label: '执行者', color: 'green' },
}

export function RunDetail({ run, onBack }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const updateRun = useAppStore((s) => s.updateRun)
  const updateNode = useAppStore((s) => s.updateNode)
  const agents = useAppStore((s) => s.agents)
  const activeTurns = useAppStore((s) => s.activeTurns)
  const appendTaskLog = useAppStore((s) => s.appendTaskLog)
  const { message } = App.useApp()

  const selectedNode = run.nodes.find((n) => n.id === selectedNodeId)

  const handleStartRun = async () => {
    try {
      const res = await runApi.start(run.id)
      updateRun(res.run)
      message.success('Run 已启动')
    } catch (err: any) {
      message.error(`启动失败: ${err.message}`)
    }
  }

  return (
    <div className="h-full flex flex-col -mx-7 -my-5 px-7 py-5">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-4">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
          className="!text-gray-500 hover:!text-indigo-600"
        >
          返回
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-gray-900">{run.name}</h3>
            <Tag color={run.status === 'running' ? 'processing' : run.status === 'completed' ? 'success' : 'default'}>
              {run.status}
            </Tag>
          </div>
          <p className="text-[12px] text-gray-400 mt-0.5">
            {run.nodes.length} 节点 · 创建于 {new Date(run.createdAt).toLocaleString('zh-CN')}
          </p>
        </div>
        {run.status === 'created' && (
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStartRun}>
            启动 Run
          </Button>
        )}
      </div>

      <div className="flex-1 flex gap-5 overflow-hidden">
        {/* 左侧：DAG 可视化 */}
        <div className="flex-1 overflow-y-auto pr-4 pl-4">
          <DAGView
            run={run}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            activeTurns={activeTurns}
          />
        </div>

        {/* 右侧：节点详情面板 — key 保证切换节点时重新挂载 */}
        {selectedNode && (
          <NodeDetailPanel
            key={selectedNode.id}
            node={selectedNode}
            run={run}
            agents={agents}
            activeTurns={activeTurns}
            onUpdate={(node) => updateNode(run.id, node)}
            appendTaskLog={appendTaskLog}
          />
        )}
      </div>
    </div>
  )
}

// ═══════════════ DAG 可视化 ═══════════════

function DAGView({ run, selectedNodeId, onSelectNode, activeTurns }: {
  run: Run
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  activeTurns: AgentTurn[]
}) {
  return (
    <div className="space-y-1">
      {run.nodes.map((node, idx) => {
        const config = nodeStatusConfig[node.status]
        const isSelected = node.id === selectedNodeId
        const hasIncoming = run.edges.some((e) => e.target === node.id)
        const role = roleConfig[node.agentRole]
        const nodeTurn = activeTurns.find((t) => t.nodeId === node.id)

        return (
          <div key={node.id}>
            {/* 连接线 */}
            {hasIncoming && (
              <div className="flex justify-center">
                <div className="w-[2px] h-4 bg-gradient-to-b from-gray-200 to-gray-300 rounded-full" />
              </div>
            )}

            {/* 节点卡片 */}
            <div
              onClick={() => onSelectNode(node.id)}
              className={`dag-node relative px-5 py-3.5 rounded-xl border cursor-pointer transition-all ${
                isSelected
                  ? 'border-indigo-400 bg-indigo-50/50 shadow-md ring-2 ring-indigo-100'
                  : 'border-gray-200/80 hover:shadow-sm hover:border-gray-300'
              } ${node.status === 'running' ? 'node-running' : ''}`}
              style={{
                backgroundColor: isSelected ? undefined : config.bgColor,
                borderColor: isSelected ? undefined : config.borderColor,
              }}
            >
              {/* 左侧序号指示器 */}
              <div className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border-2 flex items-center justify-center text-[10px] font-bold shadow-sm"
                style={{ borderColor: config.color, color: config.color }}>
                {idx + 1}
              </div>

              <div className="flex items-center gap-3 ml-3">
                {/* 状态图标 */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px]"
                  style={{ backgroundColor: `${config.color}12`, color: config.color }}
                >
                  {node.status === 'running' ? <LoadingOutlined spin /> : config.icon}
                </div>

                {/* 节点信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-gray-800">{node.name}</span>
                    <Tag color={config.tagColor} className="!text-[10px] !px-1.5 !py-0 !mr-0 !leading-4 !rounded">
                      {config.label}
                    </Tag>
                    {role && (
                      <Tag color={role.color} className="!text-[10px] !px-1.5 !py-0 !mr-0 !leading-4 !rounded">
                        {role.label}
                      </Tag>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{node.description}</p>
                </div>

                {/* 产出物 */}
                {node.artifacts.length > 0 && (
                  <Tooltip title={`${node.artifacts.length} 个产出物`}>
                    <div className="flex items-center gap-1 text-[11px] text-gray-400 bg-gray-100/80 px-2 py-1 rounded-md">
                      <FileTextOutlined />
                      <span>{node.artifacts.length}</span>
                    </div>
                  </Tooltip>
                )}
              </div>

              {/* 运行中进度提示 */}
              {node.status === 'running' && (
                <div className="mt-2 ml-2">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-[11px] text-amber-600">
                      Agent 正在执行中...
                      {nodeTurn && nodeTurn.output.length > 0 && ` (${nodeTurn.output.length} 字符输出)`}
                    </span>
                  </div>
                  {/* 迷你输出预览 */}
                  {nodeTurn && nodeTurn.output.length > 0 && (
                    <div className="mt-1.5 px-2 py-1 bg-gray-900/5 rounded text-[10px] text-gray-500 font-mono truncate max-w-full">
                      {nodeTurn.output.slice(-120)}
                    </div>
                  )}
                </div>
              )}

              {/* 错误信息 */}
              {node.error && (
                <div className="mt-2 ml-2 px-2 py-1 bg-red-50 border border-red-100 rounded-md text-[11px] text-red-600 truncate">
                  {node.error}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════ 节点详情面板 ═══════════════

function NodeDetailPanel({ node, run, agents, activeTurns, onUpdate, appendTaskLog }: {
  node: TaskNode
  run: Run
  agents: AgentConfig[]
  activeTurns: AgentTurn[]
  onUpdate: (node: TaskNode) => void
  appendTaskLog: (line: string) => void
}) {
  const [userInput, setUserInput] = useState(node.userInput || '')
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const { message } = App.useApp()

  // ★ Agent 列表：所有可用的排前面，默认选通用 Codex
  const allAgents = [...agents].sort((a, b) => {
    if (a.available && !b.available) return -1
    if (!a.available && b.available) return 1
    // 通用排前面
    if (a.id.includes('universal') && !b.id.includes('universal')) return -1
    if (!a.id.includes('universal') && b.id.includes('universal')) return 1
    return 0
  })
  // 默认选通用 Codex，其次通用 Claude，再次任意可用 Agent
  const defaultAgent =
    allAgents.find((a) => a.id === 'codex-universal' && a.available) ||
    allAgents.find((a) => a.id === 'claude-universal' && a.available) ||
    allAgents.find((a) => a.available) ||
    allAgents[0]
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgent?.id || '')
  const config = nodeStatusConfig[node.status]
  const role = roleConfig[node.agentRole]

  // 当前节点的活跃 Turn
  const currentTurn = activeTurns.find((t) => t.nodeId === node.id)

  // 选中的 Agent 是否可用
  const selectedAgent = allAgents.find((a) => a.id === selectedAgentId)
  const isAgentAvailable = selectedAgent?.available !== false

  // 拼接完整 prompt：系统指令 + 用户输入
  const buildFullPrompt = () => {
    const systemPrompt = node.prompt || node.description
    if (!userInput.trim()) return systemPrompt
    return `${systemPrompt}\n\n---\n\n## 用户需求描述\n\n${userInput.trim()}`
  }

  const handleStart = async () => {
    if (!userInput.trim()) {
      message.warning('请输入具体的需求/任务描述')
      return
    }
    if (!isAgentAvailable) {
      message.error(`选中的 Agent CLI 不可用，请选择其他 Agent`)
      return
    }
    setLoading(true)
    try {
      // 1. 启动节点（ready → running）
      const nodeRes = await nodeApi.start(run.id, node.id)
      onUpdate(nodeRes.node)
      
      // 2. 触发 Agent 执行（非阻塞，立即返回 turnId）
      const fullPrompt = buildFullPrompt()
      const project = useAppStore.getState().projects.find((p) => p.id === run.projectId)
      const { turnId } = await agentApi.executeTurn({
        agentId: selectedAgentId,
        nodeId: node.id,
        runId: run.id,
        prompt: fullPrompt,
        cwd: project?.path,
      })
      
      appendTaskLog(`[${node.name}] Agent 开始执行 (Turn: ${turnId})`)
      message.success('Agent 已启动，实时输出将在下方显示')
      // 注意：不再 await 完成，节点状态变更由后端通过 WebSocket 推送
    } catch (err: any) {
      message.error(`执行失败: ${err.message}`)
      appendTaskLog(`[${node.name}] 执行失败: ${err.message}`)
      // 尝试将节点标记为失败
      try {
        const submitRes = await nodeApi.submit(run.id, node.id, 'failed', err.message)
        onUpdate(submitRes.node)
      } catch { /* ignore */ }
    } finally {
      setLoading(false)
    }
  }

  // ★ 改进: 取消执行 — 支持从 activeTurns 或后端查询获取 turnId，若无进程则提供强制重置
  const handleCancel = async () => {
    setCancelling(true)
    try {
      let turnId = currentTurn?.id
      
      // 如果 activeTurns 里没有（WebSocket 可能未推送），则从后端查询
      if (!turnId) {
        const { turns } = await agentApi.getNodeTurns(node.id)
        const runningTurn = turns.find((t: any) => t.status === 'running')
        turnId = runningTurn?.id
      }

      if (!turnId) {
        // 无活跃进程但节点仍为 running → 提供强制重置
        message.warning('未找到正在执行的进程，尝试强制重置节点状态...')
        await handleForceReset()
        return
      }

      const res = await agentApi.cancelTurn(turnId)
      if (res.cancelled) {
        message.success('已发送取消信号，进程将在数秒内终止')
        appendTaskLog(`[${node.name}] 用户取消执行`)
      } else {
        // 进程已结束但节点卡住 → 也强制重置
        message.warning('进程已结束，正在重置节点状态...')
        await handleForceReset()
      }
    } catch (err: any) {
      message.error(`取消失败: ${err.message}`)
    } finally {
      setCancelling(false)
    }
  }

  // ★ 新增: 强制重置节点（running/failed → ready）
  const handleForceReset = async () => {
    try {
      const res = await nodeApi.forceReset(run.id, node.id)
      onUpdate(res.node)
      message.success('节点已强制重置为就绪状态')
      appendTaskLog(`[${node.name}] 节点已强制重置`)
    } catch (err: any) {
      message.error(`强制重置失败: ${err.message}`)
    }
  }

  const handleApprove = async () => {
    try {
      const res = await nodeApi.approve(run.id, node.id)
      onUpdate(res.node)
      message.success('验收通过')
      appendTaskLog(`[${node.name}] 验收通过 ✓`)
    } catch (err: any) {
      message.error(err.message)
    }
  }

  const handleReject = async () => {
    const feedback = window.prompt('请输入修改建议:')
    if (feedback === null) return
    try {
      const res = await nodeApi.reject(run.id, node.id, feedback)
      onUpdate(res.node)
      message.warning('已打回重做')
      appendTaskLog(`[${node.name}] 已打回: ${feedback}`)
    } catch (err: any) {
      message.error(err.message)
    }
  }

  const handleSkip = async () => {
    try {
      const res = await nodeApi.skip(run.id, node.id)
      onUpdate(res.node)
      appendTaskLog(`[${node.name}] 已跳过`)
    } catch (err: any) {
      message.error(err.message)
    }
  }

  const handleRollback = async () => {
    try {
      await nodeApi.rollback(run.id, node.id)
      appendTaskLog(`[${node.name}] 已回滚`)
      message.info('节点已回滚')
    } catch (err: any) {
      message.error(err.message)
    }
  }

  return (
    <Card
      className="w-[380px] shrink-0 !shadow-lg !border-0 overflow-y-auto !rounded-2xl"
      styles={{ body: { padding: '20px 22px' } }}
    >
      {/* 节点头部 */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[18px]"
          style={{ backgroundColor: `${config.color}15`, color: config.color }}
        >
          {node.status === 'running' ? <LoadingOutlined spin /> : config.icon}
        </div>
        <div className="flex-1">
          <h4 className="text-[14px] font-semibold text-gray-800">{node.name}</h4>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Tag color={config.tagColor} className="!text-[10px] !m-0">{config.label}</Tag>
            {role && <Tag color={role.color} className="!text-[10px] !m-0">{role.label}</Tag>}
          </div>
        </div>
      </div>

      <p className="text-[12px] text-gray-500 mb-4">{node.description}</p>

      {/* Agent 选择 — 显示所有 Agent，标记可用性 */}
      {(node.status === 'ready' || node.status === 'running') && allAgents.length > 0 && (
        <div className="mb-3">
          <label className="text-[12px] text-gray-500 mb-1.5 block font-medium">选择 Agent</label>
          <Select
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            size="small"
            className="w-full"
            disabled={node.status === 'running'}
            options={allAgents.map((a) => ({
              value: a.id,
              label: `${a.available === false ? '⚠️ ' : '✓ '}${a.name} (${a.type})${a.role === node.agentRole ? '' : ' · 跨角色'}${a.available === false ? ' [不可用]' : ''}`,
              disabled: a.available === false,
            }))}
          />
          {!isAgentAvailable && (
            <p className="text-[10px] text-red-500 mt-1">
              <WarningOutlined className="mr-1" />
              此 Agent 的 CLI 未安装，无法执行。请选择其他可用 Agent。
            </p>
          )}
          {selectedAgentId && isAgentAvailable && !agents.filter((a) => a.role === node.agentRole).find((a) => a.id === selectedAgentId) && (
            <p className="text-[10px] text-orange-500 mt-1">
              <WarningOutlined className="mr-1" />
              此 Agent 非本节点推荐角色，但仍可使用
            </p>
          )}
        </div>
      )}

      {/* Prompt 区域：系统指令（只读）+ 用户输入（必填） */}
      {node.status === 'ready' && (
        <div className="mb-4 space-y-3">
          {/* 系统指令 — 来自模板，只读展示（可折叠） */}
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">系统指令（模板预设，仅供参考）</label>
            <div className="px-3 py-2 bg-gray-50/80 border border-gray-100/60 rounded-lg text-[11px] text-gray-400 leading-relaxed line-clamp-3">
              {node.prompt || node.description}
            </div>
          </div>

          {/* 用户输入 — 必填，描述具体需求 */}
          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block font-medium">
              本次任务描述 <span className="text-red-400">*</span>
            </label>
            <Input.TextArea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              rows={4}
              placeholder={`简洁描述本次要做的事情，不需要完整 PRD，例如：\n\n“做一个企业内部审批系统，支持多级审批、动态表单、钎钉通知”\n“给现有的订单列表页加上筛选和导出功能”\n“修复登录页 Token 过期后未跳转的 bug”`}
              className="!text-[12px] !bg-white"
            />
            {!userInput.trim() && (
              <p className="text-[10px] text-orange-500 mt-1.5">
                <WarningOutlined className="mr-1" />
                请描述本次要做的事，Agent 会基于此进行分析和规划
              </p>
            )}
          </div>
        </div>
      )}

      {/* ★ 实时输出流面板（节点 running 时显示） */}
      {node.status === 'running' && currentTurn && (
        <AgentOutputPanel turn={currentTurn} />
      )}

      {/* 操作按钮 */}
      <Space direction="vertical" className="w-full" size="small">
        {node.status === 'ready' && (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleStart}
            loading={loading}
            disabled={!userInput.trim()}
            block
          >
            启动 Agent 执行
          </Button>
        )}

        {/* ★ 取消执行按钮 */}
        {node.status === 'running' && (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleCancel}
            loading={cancelling}
            block
            className="!bg-red-50 !border-red-200 !text-red-600 hover:!bg-red-100"
          >
            取消执行
          </Button>
        )}

        {node.status === 'wait_user_review' && (
          <>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleApprove}
              block
              style={{ backgroundColor: '#10b981' }}
            >
              确认通过
            </Button>
            <Button
              icon={<CloseCircleOutlined />}
              onClick={handleReject}
              block
              danger
            >
              打回重做
            </Button>
          </>
        )}

        {(node.status === 'ready' || node.status === 'pending') && (
          <Popconfirm title="确定跳过此节点？" onConfirm={handleSkip}>
            <Button type="text" icon={<StepForwardOutlined />} block className="!text-gray-400">
              跳过此节点
            </Button>
          </Popconfirm>
        )}

        {/* ★ failed 状态: 强制重置 + 回滚 */}
        {node.status === 'failed' && (
          <Button
            icon={<UndoOutlined />}
            onClick={handleForceReset}
            block
            className="!text-orange-600 !border-orange-200 !bg-orange-50 hover:!bg-orange-100"
          >
            强制重置为就绪
          </Button>
        )}

        {(node.status === 'completed' || node.status === 'failed') && (
          <Popconfirm title="确定回滚此节点？" onConfirm={handleRollback}>
            <Button type="text" icon={<UndoOutlined />} block className="!text-gray-400">
              回滚此节点
            </Button>
          </Popconfirm>
        )}
      </Space>

      {/* 产出物列表 */}
      {node.artifacts.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <h5 className="text-[12px] font-medium text-gray-600 mb-2">产出物 ({node.artifacts.length})</h5>
          <div className="space-y-1.5">
            {node.artifacts.map((art) => (
              <div key={art.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                <FileTextOutlined className="text-gray-400" />
                <span className="text-[12px] text-gray-600 truncate flex-1">{art.title}</span>
                <Tag className="!text-[10px] !m-0">{art.format}</Tag>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {node.error && (
        <div className="mt-4">
          <Alert
            type="error"
            showIcon
            message="执行失败"
            description={node.error}
            className="!text-[12px]"
          />
        </div>
      )}
    </Card>
  )
}

// ═══════════════ Agent 实时输出面板 ═══════════════

function AgentOutputPanel({ turn }: { turn: AgentTurn }) {
  const outputRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [turn.output])

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[12px] text-gray-500 font-medium flex items-center gap-1.5">
          <LoadingOutlined spin className="text-amber-500" />
          实时输出
        </label>
        <span className="text-[10px] text-gray-400">
          Turn #{turn.turnIndex} · {turn.agentId}
        </span>
      </div>
      <div
        ref={outputRef}
        className="terminal-output text-green-400 p-3.5 text-[11px] leading-[1.6] overflow-y-auto max-h-[240px] min-h-[80px] whitespace-pre-wrap break-all"
      >
        {turn.output || (
          <span className="text-gray-500 italic">等待 Agent 输出...</span>
        )}
        {/* 闪烁光标 */}
        <span className="inline-block w-[6px] h-[13px] bg-green-400 ml-0.5 animate-pulse" />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-gray-400">
          已输出 {turn.output.length} 字符
        </span>
        <span className="text-[10px] text-gray-400">
          {Math.round((Date.now() - turn.startedAt) / 1000)}s 已运行
        </span>
      </div>
    </div>
  )
}
