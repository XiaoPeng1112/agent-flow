import { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react'
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
  EditOutlined,
  FieldTimeOutlined,
  CopyOutlined,
  ExpandOutlined,
  CompressOutlined,
  PauseCircleOutlined,
  AppstoreOutlined,
  CodeOutlined,
  ExperimentOutlined,
  BarChartOutlined,
  SettingOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../store/appStore'
import { runApi, nodeApi, agentApi, projectApi } from '../../api'
import type { Run, TaskNode, TaskNodeStatus, AgentConfig, AgentTurn, RunDetailTab, SkillInfo, Artifact } from '../../types'

const CodeHighlighter = lazy(() => import('./CodeHighlighter'))
const AgentTreePanel = lazy(() => import('./AgentTreePanel').then(module => ({ default: module.AgentTreePanel })))
const CheckpointPanel = lazy(() => import('./CheckpointPanel').then(module => ({ default: module.CheckpointPanel })))
const ContextDBPanel = lazy(() => import('./ContextDBPanel').then(module => ({ default: module.ContextDBPanel })))
const A2APanel = lazy(() => import('./A2APanel').then(module => ({ default: module.A2APanel })))
const DiffReviewPanel = lazy(() => import('./DiffReviewPanel').then(module => ({ default: module.DiffReviewPanel })))
const MetricsPanel = lazy(() => import('./MetricsPanel').then(module => ({ default: module.MetricsPanel })))
const AutoFlowPanel = lazy(() => import('./AutoFlowPanel').then(module => ({ default: module.AutoFlowPanel })))
const WeeklyDigestPanel = lazy(() => import('./WeeklyDigestPanel').then(module => ({ default: module.WeeklyDigestPanel })))
const L1RulePanel = lazy(() => import('./L1RulePanel').then(module => ({ default: module.L1RulePanel })))
const ValidationTurnPanel = lazy(() => import('./ValidationTurnPanel').then(module => ({ default: module.ValidationTurnPanel })))
const MergeConflictPanel = lazy(() => import('./MergeConflictPanel').then(module => ({ default: module.MergeConflictPanel })))
const FeedbackAggregatePanel = lazy(() => import('./FeedbackAggregatePanel').then(module => ({ default: module.FeedbackAggregatePanel })))
const SubTurnPanel = lazy(() => import('./SubTurnPanel').then(module => ({ default: module.SubTurnPanel })))

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
  const [tokenStats, setTokenStats] = useState<{ totalTokens: number; estimatedCost?: { usd: number } } | null>(null)
  const updateRun = useAppStore((s) => s.updateRun)
  const updateNode = useAppStore((s) => s.updateNode)
  const allAgents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const activeTurns = useAppStore((s) => s.activeTurns)
  const appendTaskLog = useAppStore((s) => s.appendTaskLog)

  // ★ 根据项目 enabledAgentIds 过滤可选 Agent
  const currentProject = projects.find((p) => p.id === run.projectId)
  const demoMode = currentProject?.isDemo === true || run.isDemo === true
  const agents = currentProject?.enabledAgentIds
    ? allAgents.filter((a) => currentProject.enabledAgentIds!.includes(a.id))
    : allAgents
  const { message } = App.useApp()

  const selectedNode = run.nodes.find((n) => n.id === selectedNodeId)

  // 定期刷新 Token 统计
  useEffect(() => {
    if (run.status === 'created') return
    const fetchStats = () => {
      runApi.getTokenStats(run.id)
        .then((res) => setTokenStats(res.data))
        .catch(() => {})
    }
    fetchStats()
    const timer = setInterval(fetchStats, 10000) // 每 10 秒刷新
    return () => clearInterval(timer)
  }, [run.id, run.status])

  const handleStartRun = async () => {
    try {
      const res = await runApi.start(run.id)
      updateRun(res.run)
      message.success('Run 已启动')
    } catch (err: any) {
      message.error(`启动失败: ${err.message}`)
    }
  }

  const handlePauseRun = async () => {
    try {
      const res = await runApi.pause(run.id)
      updateRun(res.run)
      message.success('Run 已暂停，当前执行中的节点会继续完成，但不再调度新节点')
    } catch (err: any) {
      message.error(`暂停失败: ${err.message}`)
    }
  }

  const handleResumeRun = async () => {
    try {
      const res = await runApi.resume(run.id)
      updateRun(res.run)
      message.success('Run 已恢复运行')
    } catch (err: any) {
      message.error(`恢复失败: ${err.message}`)
    }
  }

  // 完成的节点数
  const completedNodes = run.nodes.filter((n) => n.status === 'completed').length
  const runningNodes = run.nodes.filter((n) => n.status === 'running').length
  const waitingNodes = run.nodes.filter((n) => n.status === 'wait_user_review').length
  const skippedNodes = run.nodes.filter((n) => n.status === 'skipped').length
  const progressPercent = run.nodes.length > 0 ? Math.round(((completedNodes + skippedNodes) / run.nodes.length) * 100) : 0

  // 计算总耗时
  const totalElapsed = useMemo(() => {
    if (!run.startedAt) return null
    const end = run.completedAt || Date.now()
    const seconds = Math.round((end - run.startedAt) / 1000)
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  }, [run.startedAt, run.completedAt])

  // 当前阶段（正在运行或等待的节点名）
  const currentStage = useMemo(() => {
    const running = run.nodes.find((n) => n.status === 'running')
    if (running) return `执行中：${running.name}`
    const waiting = run.nodes.find((n) => n.status === 'wait_user_review')
    if (waiting) return `待验收：${waiting.name}`
    const ready = run.nodes.find((n) => n.status === 'ready')
    if (ready) return `就绪：${ready.name}`
    if (run.status === 'completed') return '全部完成'
    return null
  }, [run.nodes, run.status])

  // 活跃 Agent 数量
  const activeAgentCount = activeTurns.filter((t) =>
    run.nodes.some((n) => n.id === t.nodeId)
  ).length

  return (
    <div className="h-full flex flex-col -mx-7 -my-5 px-7 py-5">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-2">
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
            <Tag color={run.status === 'running' ? 'processing' : run.status === 'paused' ? 'warning' : run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'default'}>
              {run.status === 'paused' ? '已暂停' : run.status}
            </Tag>
            {demoMode && (
              <Tag color="blue" className="!text-[11px] !m-0">
                Demo · 只读
              </Tag>
            )}
          </div>
        </div>

        {/* Token 统计徽章 */}
        {tokenStats && tokenStats.totalTokens > 0 && (
          <Tooltip title={tokenStats.estimatedCost ? `预估费用: $${tokenStats.estimatedCost.usd}` : 'Token 消耗'}>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-[11px] text-indigo-600 font-medium">
              <ThunderboltOutlined />
              <span>{tokenStats.totalTokens.toLocaleString()} tokens</span>
            </div>
          </Tooltip>
        )}

        {run.status === 'created' && (
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStartRun} disabled={demoMode}>
            启动 Run
          </Button>
        )}

        {run.status === 'running' && (
          <Button
            icon={<PauseCircleOutlined />}
            onClick={handlePauseRun}
            disabled={demoMode}
            className="!text-amber-600 !border-amber-200 !bg-amber-50 hover:!bg-amber-100"
          >
            暂停
          </Button>
        )}

        {run.status === 'paused' && (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleResumeRun}
            disabled={demoMode}
          >
            恢复运行
          </Button>
        )}
      </div>

      {/* ★ Run Overview 信息栏 */}
      <div className="mb-4 px-4 py-3 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-100">
        {/* 进度条 */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                run.status === 'completed' ? 'bg-green-500'
                  : run.status === 'failed' ? 'bg-red-400'
                  : 'bg-indigo-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-gray-600 w-10 text-right">{progressPercent}%</span>
        </div>

        {/* 概要信息行 */}
        <div className="flex items-center gap-4 text-[11px] text-gray-500 flex-wrap">
          {/* 当前阶段 */}
          {currentStage && (
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${
                runningNodes > 0 ? 'bg-amber-400 animate-pulse' : waitingNodes > 0 ? 'bg-orange-400' : 'bg-green-400'
              }`} />
              <span className="font-medium text-gray-700">{currentStage}</span>
            </div>
          )}
          {/* 统计指标 */}
          <div className="flex items-center gap-3 ml-auto">
            <span>{completedNodes}/{run.nodes.length} 已完成</span>
            {runningNodes > 0 && <span className="text-amber-600">{runningNodes} 执行中</span>}
            {waitingNodes > 0 && <span className="text-orange-600">{waitingNodes} 待验收</span>}
            {activeAgentCount > 0 && (
              <span className="text-indigo-600 flex items-center gap-0.5">
                <LoadingOutlined spin className="text-[9px]" /> {activeAgentCount} Agent 活跃
              </span>
            )}
            {totalElapsed && (
              <span className="flex items-center gap-0.5">
                <FieldTimeOutlined className="text-[10px]" /> {totalElapsed}
              </span>
            )}
          </div>
        </div>
      </div>

      <ResizableSplitPane
        run={run}
        selectedNodeId={selectedNodeId}
        setSelectedNodeId={setSelectedNodeId}
        activeTurns={activeTurns}
        selectedNode={selectedNode}
        agents={agents}
        updateNode={updateNode}
        appendTaskLog={appendTaskLog}
      />
    </div>
  )
}

// ═══════════════ 可拖拽分割面板 ═══════════════

function ResizableSplitPane({ run, selectedNodeId, setSelectedNodeId, activeTurns, selectedNode, agents, updateNode, appendTaskLog }: {
  run: Run
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  activeTurns: AgentTurn[]
  selectedNode: TaskNode | undefined
  agents: AgentConfig[]
  updateNode: (runId: string, node: TaskNode) => void
  appendTaskLog: (line: string, level?: 'info' | 'success' | 'warning' | 'error') => void
}) {
  // 右侧面板宽度（px），默认 380px，可拖拽调整
  const [rightWidth, setRightWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('agentflow_split_width')
      return saved ? Math.max(280, Math.min(600, parseInt(saved, 10))) : 380
    } catch { return 380 }
  })
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    startX.current = e.clientX
    startWidth.current = rightWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [rightWidth])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      // 向左拖 → 右面板变宽（startX - currentX > 0 表示鼠标左移）
      const delta = startX.current - e.clientX
      const newWidth = Math.max(280, Math.min(600, startWidth.current + delta))
      setRightWidth(newWidth)
    }
    const handleMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // 持久化
      try { localStorage.setItem('agentflow_split_width', String(rightWidth)) } catch {}
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [rightWidth])

  const runDetailTab = useAppStore((s) => s.runDetailTab)
  const setRunDetailTab = useAppStore((s) => s.setRunDetailTab)
  const demoMode = useAppStore((s) => s.projects.find((project) => project.id === run.projectId)?.isDemo === true) || run.isDemo === true
  const visibleTabs = (demoMode
    ? [
        { key: 'dag', label: 'DAG 视图' },
        { key: 'context-db', label: 'Context DB' },
      ]
    : [
        { key: 'dag', label: 'DAG 视图' },
        { key: 'diff-review', label: 'Diff Review' },
        { key: 'metrics', label: 'Metrics' },
        { key: 'autoflow', label: 'AutoFlow' },
        { key: 'digest', label: '周报摘要' },
        { key: 'l1-rules', label: 'L1 规则' },
        { key: 'validation', label: '验证' },
        { key: 'merge-conflict', label: '冲突检测' },
        { key: 'feedback', label: '反馈聚合' },
        { key: 'agent-tree', label: 'Agent Tree' },
        { key: 'checkpoint', label: 'Checkpoint' },
        { key: 'context-db', label: 'Context DB' },
        { key: 'a2a', label: 'A2A 消息' },
        { key: 'sub-turn', label: '对抗审查' },
      ]) as { key: RunDetailTab; label: string }[]

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.key === runDetailTab)) {
      setRunDetailTab('dag')
    }
  }, [runDetailTab, setRunDetailTab, visibleTabs])

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Tab 切换栏 — 可横向滚动 */}
      <div className="overflow-x-auto scrollbar-hide shrink-0 border-b border-gray-100 mb-2">
        <div className="flex items-center gap-0.5 px-4 pb-2 min-w-max">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              className={`px-2.5 py-1.5 text-[11px] rounded-md transition-colors whitespace-nowrap ${
                runDetailTab === tab.key
                  ? 'bg-indigo-50 text-indigo-600 font-semibold border border-indigo-100'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setRunDetailTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[12px] text-gray-400">加载中...</div>}>
      {runDetailTab === 'diff-review' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <DiffReviewPanel run={run} />
        </div>
      ) : runDetailTab === 'metrics' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <MetricsPanel run={run} />
        </div>
      ) : runDetailTab === 'agent-tree' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <AgentTreePanel run={run} />
        </div>
      ) : runDetailTab === 'log' || runDetailTab === 'checkpoint' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <CheckpointPanel run={run} />
        </div>
      ) : runDetailTab === 'context-db' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <ContextDBPanel projectId={run.projectId} templateId={run.templateId} runId={run.id} />
        </div>
      ) : runDetailTab === 'a2a' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <A2APanel run={run} />
        </div>
      ) : runDetailTab === 'autoflow' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <AutoFlowPanel run={run} />
        </div>
      ) : runDetailTab === 'digest' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <WeeklyDigestPanel run={run} />
        </div>
      ) : runDetailTab === 'l1-rules' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <L1RulePanel run={run} />
        </div>
      ) : runDetailTab === 'validation' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <ValidationTurnPanel run={run} />
        </div>
      ) : runDetailTab === 'merge-conflict' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <MergeConflictPanel run={run} />
        </div>
      ) : runDetailTab === 'feedback' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <FeedbackAggregatePanel run={run} />
        </div>
      ) : runDetailTab === 'sub-turn' ? (
        <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white mx-4">
          <SubTurnPanel run={run} />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：DAG 可视化 */}
          <div className="flex-1 overflow-y-auto px-4 min-w-[300px]">
            <DAGView
              run={run}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              activeTurns={activeTurns}
            />
          </div>

          {/* 拖拽分隔条 */}
          {selectedNode && (
            <div
              className="w-[5px] shrink-0 cursor-col-resize relative group flex items-center justify-center hover:bg-indigo-50 transition-colors"
              onMouseDown={handleMouseDown}
            >
              <div className="w-[3px] h-8 rounded-full bg-gray-200 group-hover:bg-indigo-400 transition-colors" />
            </div>
          )}

          {/* 右侧：节点详情面板 */}
          {selectedNode && (
            <div style={{ width: rightWidth }} className="shrink-0 overflow-y-auto">
              <NodeDetailPanel
                key={selectedNode.id}
                node={selectedNode}
                run={run}
                agents={agents}
                activeTurns={activeTurns}
                onUpdate={(node) => updateNode(run.id, node)}
                appendTaskLog={appendTaskLog}
              />
            </div>
          )}
        </div>
      )}
      </Suspense>
    </div>
  )
}

// ═══════════════ 节点计时器 ═══════════════

function NodeTimer({ startedAt, completedAt, status }: {
  startedAt?: number
  completedAt?: number
  status: TaskNodeStatus
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) return

    if (completedAt) {
      // 已完成，显示固定耗时
      setElapsed(Math.round((completedAt - startedAt) / 1000))
      return
    }

    if (status !== 'running' && status !== 'wait_user_review') return

    // running 状态实时更新
    setElapsed(Math.round((Date.now() - startedAt) / 1000))
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [startedAt, completedAt, status])

  if (!startedAt || elapsed === 0) return null

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}m ${sec}s`
  }

  const isActive = status === 'running'
  return (
    <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
      isActive
        ? 'text-amber-600 bg-amber-50'
        : 'text-gray-400 bg-gray-50'
    }`}>
      <FieldTimeOutlined className={isActive ? 'animate-pulse' : ''} />
      <span>{formatTime(elapsed)}</span>
    </div>
  )
}

// ═══════════════ DAG 图形化可视化（@xyflow/react） ═══════════════

import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  type Node as FlowNode,
  type Edge as FlowEdge,
  Position,
  Handle,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// 自定义节点组件
function DAGCustomNode({ data }: { data: any }) {
  const { node, config, role, isSelected, nodeTurn } = data
  return (
    <div
      className={`dag-node relative px-4 py-3 rounded-xl border cursor-pointer transition-all min-w-[200px] max-w-[260px] ${
        isSelected
          ? 'border-indigo-400 bg-indigo-50/50 shadow-lg ring-2 ring-indigo-100'
          : 'border-gray-200/80 hover:shadow-md hover:border-gray-300'
      } ${node.status === 'running' ? 'node-running' : ''}`}
      style={{
        backgroundColor: isSelected ? undefined : config.bgColor,
        borderColor: isSelected ? undefined : config.borderColor,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !border-gray-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !border-gray-400 !w-2 !h-2" />

      <div className="flex items-center gap-2.5">
        {/* 状态图标 */}
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[14px] shrink-0"
          style={{ backgroundColor: `${config.color}18`, color: config.color }}
        >
          {node.status === 'running' ? <LoadingOutlined spin /> : config.icon}
        </div>

        {/* 节点信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-semibold text-gray-800 truncate">{node.name}</span>
            <Tag color={config.tagColor} className="!text-[9px] !px-1 !py-0 !mr-0 !leading-3.5 !rounded">
              {config.label}
            </Tag>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 truncate">{node.description}</p>
        </div>
      </div>

      {/* 底部信息栏 */}
      <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-gray-100/80">
        {role && (
          <Tag color={role.color} className="!text-[9px] !px-1 !py-0 !m-0 !leading-3.5 !rounded">
            {role.label}
          </Tag>
        )}
        {/* 执行模式标识 */}
        {node.executionMode && node.executionMode !== 'llm' && (
          <Tag
            color={node.executionMode === 'det' ? 'cyan' : 'geekblue'}
            className="!text-[9px] !px-1 !py-0 !m-0 !leading-3.5 !rounded"
          >
            {node.executionMode === 'det' ? '⚡ DET' : '🔄 HYB'}
          </Tag>
        )}
        {node.startedAt && (
          <NodeTimer startedAt={node.startedAt} completedAt={node.completedAt} status={node.status} />
        )}
        {node.artifacts.length > 0 && (
          <div className="flex items-center gap-0.5 text-[9px] text-gray-400 ml-auto">
            <FileTextOutlined className="text-[9px]" />
            <span>{node.artifacts.length}</span>
          </div>
        )}
      </div>

      {/* 运行中动画提示 */}
      {node.status === 'running' && (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[9px] text-amber-600">
              执行中{nodeTurn && nodeTurn.output.length > 0 && ` · ${nodeTurn.output.length}字符`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

const nodeTypes = { dagNode: DAGCustomNode }

function DAGView({ run, selectedNodeId, onSelectNode, activeTurns }: {
  run: Run
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  activeTurns: AgentTurn[]
}) {
  return (
    <ReactFlowProvider>
      <DAGViewInner run={run} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} activeTurns={activeTurns} />
    </ReactFlowProvider>
  )
}

function DAGViewInner({ run, selectedNodeId, onSelectNode, activeTurns }: {
  run: Run
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  activeTurns: AgentTurn[]
}) {
  const { fitView } = useReactFlow()

  // 当选中节点变化时（右侧面板打开/关闭），等容器 resize 后重新 fitView
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.3, duration: 300 })
    }, 50)
    return () => clearTimeout(timer)
  }, [selectedNodeId, fitView])
  // 基于拓扑分层构建布局
  const { flowNodes, flowEdges } = useMemo(() => {
    // 拓扑分层
    const inDegree = new Map<string, number>()
    const adjList = new Map<string, string[]>()
    for (const node of run.nodes) {
      inDegree.set(node.id, 0)
      adjList.set(node.id, [])
    }
    for (const edge of run.edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
      adjList.get(edge.source)?.push(edge.target)
    }

    const layers: string[][] = []
    let queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
    while (queue.length > 0) {
      layers.push([...queue])
      const nextQueue: string[] = []
      for (const curr of queue) {
        for (const neighbor of adjList.get(curr) || []) {
          const newDeg = (inDegree.get(neighbor) || 1) - 1
          inDegree.set(neighbor, newDeg)
          if (newDeg === 0) nextQueue.push(neighbor)
        }
      }
      queue = nextQueue
    }

    // 自动布局：垂直分层，水平居中
    const NODE_WIDTH = 240
    const NODE_HEIGHT = 100
    const LAYER_GAP_Y = 80
    const NODE_GAP_X = 40

    const nodes: FlowNode[] = []
    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layer = layers[layerIdx]
      const totalWidth = layer.length * NODE_WIDTH + (layer.length - 1) * NODE_GAP_X
      const startX = -totalWidth / 2

      for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
        const nodeId = layer[nodeIdx]
        const taskNode = run.nodes.find((n) => n.id === nodeId)
        if (!taskNode) continue

        const config = nodeStatusConfig[taskNode.status]
        const role = roleConfig[taskNode.agentRole]
        const nodeTurn = activeTurns.find((t) => t.nodeId === taskNode.id)

        nodes.push({
          id: nodeId,
          type: 'dagNode',
          position: {
            x: startX + nodeIdx * (NODE_WIDTH + NODE_GAP_X),
            y: layerIdx * (NODE_HEIGHT + LAYER_GAP_Y),
          },
          data: {
            node: taskNode,
            config,
            role,
            isSelected: nodeId === selectedNodeId,
            nodeTurn,
          },
        })
      }
    }

    // 构建边
    const edges: FlowEdge[] = run.edges.map((edge, idx) => {
      const sourceNode = run.nodes.find((n) => n.id === edge.source)
      const targetNode = run.nodes.find((n) => n.id === edge.target)
      const isActive = sourceNode?.status === 'completed' && (targetNode?.status === 'running' || targetNode?.status === 'ready')
      const isCompleted = sourceNode?.status === 'completed' && targetNode?.status === 'completed'

      return {
        id: `e-${idx}`,
        source: edge.source,
        target: edge.target,
        animated: isActive,
        style: {
          stroke: isCompleted ? '#10b981' : isActive ? '#6366f1' : '#d1d5db',
          strokeWidth: isActive ? 2.5 : 1.5,
        },
      }
    })

    return { flowNodes: nodes, flowEdges: edges }
  }, [run.nodes, run.edges, selectedNodeId, activeTurns])

  const handleNodeClick = (_event: React.MouseEvent, node: FlowNode) => {
    onSelectNode(node.id)
  }

  return (
    <div className="h-full w-full min-h-[400px] rounded-xl overflow-hidden border border-gray-100 bg-white">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
      </ReactFlow>
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
  appendTaskLog: (line: string, level?: 'info' | 'success' | 'warning' | 'error') => void
}) {
  const [userInput, setUserInput] = useState(node.userInput || '')
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const { message } = App.useApp()
  const isDemo = useAppStore((s) => s.projects.find((project) => project.id === run.projectId)?.isDemo === true) || run.isDemo === true

  // ★ Agent 列表：所有可用的排前面，同角色优先
  const allAgents = [...agents].sort((a, b) => {
    if (a.available && !b.available) return -1
    if (!a.available && b.available) return 1
    // 同角色排前面
    const aRoleMatch = a.role === node.agentRole ? 1 : 0
    const bRoleMatch = b.role === node.agentRole ? 1 : 0
    if (aRoleMatch !== bRoleMatch) return bRoleMatch - aRoleMatch
    // 通用排前面
    if (a.id.includes('universal') && !b.id.includes('universal')) return -1
    if (!a.id.includes('universal') && b.id.includes('universal')) return 1
    return 0
  })
  // ★ 智能匹配：按节点 agentRole 自动选择最佳 Agent
  // 优先选同角色的 Codex Agent，其次同角色 Claude，再次 universal 兜底
  const roleMatchMap: Record<string, string> = {
    planner: 'codex-planner',
    manager: 'codex-manager',
    executor: 'codex-coder',
  }
  const bestMatchId = roleMatchMap[node.agentRole]
  const defaultAgent =
    allAgents.find((a) => a.id === bestMatchId && a.available) ||
    allAgents.find((a) => a.role === node.agentRole && a.category === 'codex' && a.available) ||
    allAgents.find((a) => a.role === node.agentRole && a.available) ||
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
    const isDET = node.executionMode === 'det'
    const isHYB = node.executionMode === 'hyb'

    // DET 模式不需要用户输入（脚本已预设），LLM/HYB 模式需要
    if (!isDET && !userInput.trim()) {
      message.warning('请输入具体的需求/任务描述')
      return
    }
    if (!isDET && !isHYB && !isAgentAvailable) {
      message.error(`选中的 Agent CLI 不可用，请选择其他 Agent`)
      return
    }
    if ((isDET || isHYB) && !node.script) {
      message.error('DET/HYB 模式需要配置脚本命令')
      return
    }
    setLoading(true)
    try {
      // 1. 启动节点（ready → running）
      const nodeRes = await nodeApi.start(run.id, node.id)
      onUpdate(nodeRes.node)
      
      const project = useAppStore.getState().projects.find((p) => p.id === run.projectId)
      const cwd = node.scriptCwd
        ? (project?.path ? `${project.path}/${node.scriptCwd}` : node.scriptCwd)
        : project?.path

      if (isDET || isHYB) {
        // 2a. DET/HYB 模式：执行脚本
        const { turnId } = await agentApi.executeDET({
          nodeId: node.id,
          runId: run.id,
          script: node.script!,
          cwd,
          executionMode: node.executionMode as 'det' | 'hyb',
          agentId: isHYB ? selectedAgentId : undefined,
          prompt: isHYB ? buildFullPrompt() : undefined,
        })
        appendTaskLog(`[${node.name}] ${isDET ? 'DET 脚本' : 'HYB 脚本'}开始执行 (Turn: ${turnId})`)
        message.success(isDET ? '脚本已启动' : '混合模式启动（先执行脚本）')
      } else {
        // 2b. LLM 模式：使用动态 Agent 实例执行（自动装配 scoped context）
        const { turnId, instanceName } = await agentApi.executeDynamic({
          nodeId: node.id,
          runId: run.id,
          userInput: userInput.trim(),
          preferredAgentId: selectedAgentId,
          cwd,
        })
        appendTaskLog(`[${node.name}] 动态 Agent "${instanceName}" 开始执行 (Turn: ${turnId})`)
        message.success('Agent 已动态创建并启动')
      }
    } catch (err: any) {
      message.error(`执行失败: ${err.message}`)
      appendTaskLog(`[${node.name}] 执行失败: ${err.message}`, 'error')
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
        appendTaskLog(`[${node.name}] 用户取消执行`, 'warning')
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

  const handleResumeSession = async () => {
    setLoading(true)
    try {
      const { turns } = await agentApi.getNodeTurns(node.id)
      const previous = turns.at(-1)
      if (!previous?.providerExecution?.sessionId) throw new Error('上次尝试没有可恢复的会话，请重置后重新执行')
      await agentApi.resumeTurn({ runId: run.id, nodeId: node.id, turnId: previous.id,
        prompt: userInput.trim() || '继续完成上次中断的任务。先检查现有修改和已执行操作，避免重复外部副作用。' })
      onUpdate({ ...node, status: 'running', error: undefined })
      message.success('已在原工作区恢复会话')
    } catch (error: any) { message.error(error.message) } finally { setLoading(false) }
  }

  // ★ 新增: 强制重置节点（running/failed → ready）
  const handleForceReset = async () => {
    try {
      const res = await nodeApi.forceReset(run.id, node.id)
      onUpdate(res.node)
      message.success('节点已强制重置为就绪状态')
      appendTaskLog(`[${node.name}] 节点已强制重置`, 'warning')
    } catch (err: any) {
      message.error(`强制重置失败: ${err.message}`)
    }
  }

  const handleApprove = async (withFeedback = false) => {
    try {
      const feedback = withFeedback ? feedbackText.trim() : undefined
      const res = await nodeApi.approve(run.id, node.id, feedback)
      onUpdate(res.node)
      if (feedback) {
        message.success('已通过，修改意见将传递给后续节点')
        appendTaskLog(`[${node.name}] 验收通过 ✓ (附修改意见)`, 'success')
      } else {
        message.success('验收通过')
        appendTaskLog(`[${node.name}] 验收通过 ✓`, 'success')
      }
      setShowFeedback(false)
      setFeedbackText('')
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
      setUserInput(res.node.userInput || '')
      message.warning('已打回重做')
      appendTaskLog(`[${node.name}] 已打回: ${feedback}`, 'warning')
    } catch (err: any) {
      message.error(err.message)
    }
  }

  const handleSkip = async () => {
    try {
      const res = await nodeApi.skip(run.id, node.id)
      onUpdate(res.node)
      appendTaskLog(`[${node.name}] 已跳过`, 'info')
    } catch (err: any) {
      message.error(err.message)
    }
  }

  const handleRollback = async () => {
    try {
      await nodeApi.rollback(run.id, node.id)
      appendTaskLog(`[${node.name}] 已回滚`, 'warning')
      message.info('节点已回滚')
    } catch (err: any) {
      message.error(err.message)
    }
  }

  return (
    <Card
      className="w-full h-full !shadow-lg !border-0 overflow-y-auto !rounded-2xl"
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
            {isDemo && <Tag color="blue" className="!text-[10px] !m-0">Demo 只读</Tag>}
          </div>
        </div>
      </div>

      <p className="text-[12px] text-gray-500 mb-4">{node.description}</p>

      {/* DET/HYB 模式信息 */}
      {node.executionMode && node.executionMode !== 'llm' && node.script && (
        <div className="mb-3 px-3 py-2 bg-cyan-50 border border-cyan-100 rounded-lg">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-700 mb-1">
            <ThunderboltOutlined />
            {node.executionMode === 'det' ? '确定性执行模式' : '混合执行模式'}
          </div>
          <code className="text-[11px] text-cyan-800 bg-cyan-100/50 px-2 py-0.5 rounded block">
            {node.script}
          </code>
          {node.scriptCwd && (
            <span className="text-[10px] text-cyan-500 mt-1 block">工作目录: {node.scriptCwd}</span>
          )}
          {node.executionMode === 'hyb' && (
            <span className="text-[10px] text-cyan-500 mt-1 block">⚠️ 脚本失败将自动回退到 LLM Agent</span>
          )}
        </div>
      )}

      {/* Agent 选择 — 显示所有 Agent，标记可用性（DET 模式不显示） */}
      {(node.status === 'ready' || node.status === 'running') && allAgents.length > 0 && node.executionMode !== 'det' && (
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
              label: `${a.available === false ? '⚠️ ' : '✓ '}${a.name} · ${a.role}${a.role !== node.agentRole ? '（跨角色）' : ''}${a.available === false ? ' [不可用]' : ''}`,
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

      {/* Skill 绑定区域 — 节点 ready/pending 时可配置 */}
      {(node.status === 'ready' || node.status === 'pending') && (
        <NodeSkillBinding runId={run.id} node={node} projectId={run.projectId} onUpdate={onUpdate} />
      )}

      {/* Prompt 区域：系统指令（只读）+ 用户输入（DET 模式不需要输入） */}
      {node.status === 'ready' && (
        <div className="mb-4 space-y-3">
          {/* 系统指令 — 来自模板，只读展示（可折叠） */}
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">系统指令（模板预设，仅供参考）</label>
            <div className="px-3 py-2 bg-gray-50/80 border border-gray-100/60 rounded-lg text-[11px] text-gray-400 leading-relaxed line-clamp-3">
              {node.prompt || node.description}
            </div>
          </div>

          {/* 用户输入 — DET 模式不需要，HYB/LLM 必填 */}
          {node.executionMode !== 'det' && (
            <div>
              <label className="text-[12px] text-gray-600 mb-1.5 block font-medium">
                本次任务描述 <span className="text-red-400">*</span>
              </label>
              <Input.TextArea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                rows={4}
                placeholder={`简洁描述本次要做的事情，不需要完整 PRD，例如：\n\n"做一个企业内部审批系统，支持多级审批、动态表单、钎钉通知"\n"给现有的订单列表页加上筛选和导出功能"\n"修复登录页 Token 过期后未跳转的 bug"`}
                className="!text-[12px] !bg-white"
              />
              {!userInput.trim() && (
                <p className="text-[10px] text-orange-500 mt-1.5">
                  <WarningOutlined className="mr-1" />
                  请描述本次要做的事，Agent 会基于此进行分析和规划
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ★ 实时输出流面板（节点 running 时显示） */}
      {node.status === 'running' && currentTurn && (
        <AgentOutputPanel turn={currentTurn} />
      )}

      {/* ★ Agent 最终输出展示（wait_user_review 时显示） */}
      {node.status === 'wait_user_review' && node.artifacts.length === 0 && (
        <AgentResultPreview nodeId={node.id} />
      )}

      {/* ★ 修改后继续 — 输入区域 */}
      {node.status === 'wait_user_review' && showFeedback && (
        <div className="mb-3">
          <label className="text-[12px] text-gray-600 mb-1.5 block font-medium">
            修改意见（将传递给后续节点）
          </label>
          <Input.TextArea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            rows={3}
            placeholder="描述需要调整的地方，例如：\n· 请增加对边界情况的考虑\n· 方案二更优，请按方案二执行"
            className="!text-[12px] !bg-white"
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <Button
              type="primary"
              size="small"
              disabled={!feedbackText.trim()}
              onClick={() => handleApprove(true)}
              className="flex-1"
            >
              确认并继续
            </Button>
            <Button
              size="small"
              onClick={() => { setShowFeedback(false); setFeedbackText('') }}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <Space direction="vertical" className="w-full" size="small">
        {node.status === 'ready' && (
          <Button
            type="primary"
            icon={node.executionMode === 'det' ? <ThunderboltOutlined /> : <SendOutlined />}
            onClick={handleStart}
            loading={loading}
            disabled={isDemo || (node.executionMode !== 'det' && !userInput.trim())}
            block
          >
            {node.executionMode === 'det' ? '执行脚本' : node.executionMode === 'hyb' ? '启动混合执行' : '启动 Agent 执行'}
          </Button>
        )}

        {/* ★ 取消执行按钮 */}
        {node.status === 'running' && (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleCancel}
            loading={cancelling}
            disabled={isDemo}
            block
            className="!bg-red-50 !border-red-200 !text-red-600 hover:!bg-red-100"
          >
            取消执行
          </Button>
        )}

        {node.status === 'wait_user_review' && !showFeedback && (
          <>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => handleApprove(false)}
              disabled={isDemo}
              block
              style={{ backgroundColor: '#10b981' }}
            >
              确认通过
            </Button>
            <Button
              icon={<EditOutlined />}
              onClick={() => setShowFeedback(true)}
              disabled={isDemo}
              block
              className="!text-blue-600 !border-blue-200 !bg-blue-50 hover:!bg-blue-100"
            >
              修改后继续
            </Button>
            <Button
              icon={<CloseCircleOutlined />}
              onClick={handleReject}
              disabled={isDemo}
              block
              danger
            >
              打回重做
            </Button>
          </>
        )}

        {(node.status === 'ready' || node.status === 'pending') && (
          <Popconfirm title="确定跳过此节点？" onConfirm={handleSkip} disabled={isDemo}>
            <Button type="text" icon={<StepForwardOutlined />} block className="!text-gray-400" disabled={isDemo}>
              跳过此节点
            </Button>
          </Popconfirm>
        )}

        {node.status === 'failed' && node.executionMode !== 'det' && (
          <Button onClick={handleResumeSession} loading={loading} disabled={isDemo || run.status !== 'running'} block>
            恢复上次会话
          </Button>
        )}

        {/* ★ failed 状态: 强制重置 + 回滚 */}
        {node.status === 'failed' && (
          <Button
            icon={<UndoOutlined />}
            onClick={handleForceReset}
            disabled={isDemo}
            block
            className="!text-orange-600 !border-orange-200 !bg-orange-50 hover:!bg-orange-100"
          >
            强制重置为就绪
          </Button>
        )}

        {(node.status === 'completed' || node.status === 'failed') && (
          <Popconfirm title="确定回滚此节点？" onConfirm={handleRollback} disabled={isDemo}>
            <Button type="text" icon={<UndoOutlined />} block className="!text-gray-400" disabled={isDemo}>
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
              <ArtifactItem key={art.id} artifact={art} />
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

// ═══════════════ 产出物展示组件 ═══════════════

const ARTIFACT_CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string; label: string }> = {
  code: { icon: <CodeOutlined />, color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-100', label: '代码' },
  document: { icon: <FileTextOutlined />, color: 'text-green-600', bgColor: 'bg-green-50 border-green-100', label: '文档' },
  test: { icon: <ExperimentOutlined />, color: 'text-purple-600', bgColor: 'bg-purple-50 border-purple-100', label: '测试' },
  report: { icon: <BarChartOutlined />, color: 'text-orange-600', bgColor: 'bg-orange-50 border-orange-100', label: '报告' },
  config: { icon: <SettingOutlined />, color: 'text-gray-600', bgColor: 'bg-gray-50 border-gray-200', label: '配置' },
}

function ArtifactItem({ artifact }: { artifact: Artifact }) {
  const [expanded, setExpanded] = useState(false)
  const config = ARTIFACT_CATEGORY_CONFIG[artifact.category] || ARTIFACT_CATEGORY_CONFIG.document
  const hasContent = artifact.content && artifact.content.length > 0

  return (
    <div className={`rounded-lg border ${config.bgColor} overflow-hidden transition-all`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 ${hasContent ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={() => hasContent && setExpanded(!expanded)}
      >
        <span className={`${config.color} text-[13px]`}>{config.icon}</span>
        <span className="text-[12px] text-gray-700 truncate flex-1 font-medium">{artifact.title}</span>
        <Tag className="!text-[10px] !m-0 !border-0 !bg-white/60" color={artifact.category === 'code' ? 'blue' : artifact.category === 'test' ? 'purple' : artifact.category === 'report' ? 'orange' : 'green'}>
          {artifact.format}
        </Tag>
        {hasContent && (
          <span className="text-[10px] text-gray-400 transition-transform">
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
        )}
      </div>
      {expanded && hasContent && (
        <div className="px-3 pb-3 border-t border-white/50">
          <div className="mt-2 max-h-[200px] overflow-auto rounded bg-gray-900 text-[11px]">
            {artifact.category === 'code' ? (
              <Suspense fallback={<pre className="m-0 p-3 text-gray-200 whitespace-pre-wrap">{artifact.content}</pre>}>
                <CodeHighlighter
                  language={artifact.format === 'typescript' ? 'tsx' : artifact.format || 'text'}
                  customStyle={{ margin: 0, padding: '10px 12px', fontSize: '11px', background: 'transparent' }}
                  wrapLongLines
                >
                  {artifact.content || ''}
                </CodeHighlighter>
              </Suspense>
            ) : (
              <div className="p-3 text-gray-200 whitespace-pre-wrap leading-relaxed">
                {(artifact.content || '').slice(0, 1000)}
                {(artifact.content || '').length > 1000 && (
                  <span className="text-gray-500 ml-1">... (已截断)</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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

// ═══════════════ Agent 结果预览（Markdown 渲染 + 代码高亮） ═══════════════

function AgentResultPreview({ nodeId }: { nodeId: string }) {
  const [output, setOutput] = useState<string>('')
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [renderMode, setRenderMode] = useState<'markdown' | 'raw'>('markdown')

  useEffect(() => {
    // 从 API 获取该节点最后一个 turn 的输出
    agentApi.getNodeTurns(nodeId)
      .then(({ turns }) => {
        const lastCompleted = [...turns].reverse().find((t: any) => t.status === 'completed')
        if (lastCompleted?.output) setOutput(lastCompleted.output)
      })
      .catch(() => {})
  }, [nodeId])

  if (!output) return null

  const handleCopy = () => {
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const displayContent = output.length > 2000 && !expanded ? output.slice(0, 2000) : output

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[12px] text-gray-500 font-medium">Agent 输出结果</label>
        <div className="flex items-center gap-2">
          {/* 渲染模式切换 */}
          <button
            onClick={() => setRenderMode(renderMode === 'markdown' ? 'raw' : 'markdown')}
            className="text-[10px] text-gray-400 hover:text-indigo-500 transition-colors"
            title={renderMode === 'markdown' ? '切换为原始文本' : '切换为 Markdown'}
          >
            {renderMode === 'markdown' ? 'MD' : 'TXT'}
          </button>
          {/* 复制 */}
          <button
            onClick={handleCopy}
            className={`text-[10px] transition-colors ${copied ? 'text-green-500' : 'text-gray-400 hover:text-indigo-500'}`}
            title="复制全部内容"
          >
            <CopyOutlined />
          </button>
          {/* 展开/收起 */}
          {output.length > 2000 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5"
            >
              {expanded ? <><CompressOutlined /> 收起</> : <><ExpandOutlined /> 展开全部</>}
            </button>
          )}
        </div>
      </div>

      <div className={`border border-gray-100 rounded-lg overflow-hidden ${expanded ? 'max-h-[600px]' : 'max-h-[300px]'} overflow-y-auto`}>
        {renderMode === 'markdown' ? (
          <div className="markdown-preview px-4 py-3 text-[12px] leading-relaxed text-gray-700 prose prose-sm max-w-none
            prose-headings:text-gray-800 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5
            prose-p:my-1.5 prose-li:my-0.5
            prose-code:text-[11px] prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-indigo-600
            prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent
            prose-a:text-indigo-500 prose-a:no-underline hover:prose-a:underline
            prose-table:text-[11px] prose-th:bg-gray-50 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1
            prose-blockquote:border-l-indigo-300 prose-blockquote:text-gray-500 prose-blockquote:my-2
            prose-hr:my-3"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeString = String(children).replace(/\n$/, '')
                  if (match) {
                    return (
                      <div className="relative group rounded-lg overflow-hidden my-2">
                        <div className="flex items-center justify-between px-3 py-1 bg-gray-800 text-[10px] text-gray-400">
                          <span>{match[1]}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(codeString)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-white"
                          >
                            复制
                          </button>
                        </div>
                        <Suspense fallback={<pre className="m-0 p-3 bg-gray-900 text-gray-100">{codeString}</pre>}>
                          <CodeHighlighter
                            language={match[1]}
                            preTag="div"
                            customStyle={{ margin: 0, borderRadius: 0, fontSize: '11px' }}
                          >
                            {codeString}
                          </CodeHighlighter>
                        </Suspense>
                      </div>
                    )
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {displayContent}
            </ReactMarkdown>
            {output.length > 2000 && !expanded && (
              <div className="text-center py-2 text-[11px] text-gray-400 border-t border-gray-100 mt-2">
                ···  内容已截断（共 {output.length} 字符）
              </div>
            )}
          </div>
        ) : (
          <div className="px-3 py-2.5 bg-gray-50 text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap font-mono">
            {displayContent}
            {output.length > 2000 && !expanded && (
              <div className="text-center py-2 text-gray-400 border-t border-gray-100 mt-2">
                ···  内容已截断（共 {output.length} 字符）
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════ 节点 Skill 绑定组件 ═══════════════

function NodeSkillBinding({ runId, node, projectId, onUpdate }: {
  runId: string
  node: TaskNode
  projectId: string
  onUpdate: (node: TaskNode) => void
}) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(node.skillIds || [])
  const { message } = App.useApp()

  useEffect(() => {
    loadSkills()
  }, [projectId])

  useEffect(() => {
    setSelectedIds(node.skillIds || [])
  }, [node.id])

  const loadSkills = async () => {
    setLoading(true)
    try {
      const res = await projectApi.getSkills(projectId)
      setSkills(res.skills || [])
    } catch {
      // 加载失败静默处理
    } finally {
      setLoading(false)
    }
  }

  const handleChange = async (newIds: string[]) => {
    setSelectedIds(newIds)

    setSaving(true)
    try {
      const res = await nodeApi.updateSkills(runId, node.id, newIds)
      onUpdate(res.node)
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
      setSelectedIds(node.skillIds || [])  // 回滚
    } finally {
      setSaving(false)
    }
  }

  if (loading || skills.length === 0) return null

  return (
    <div className="mb-3">
      <label className="text-[12px] text-gray-500 mb-1.5 block font-medium flex items-center gap-1.5">
        <AppstoreOutlined className="text-indigo-400" />
        绑定 Skills
        {saving && <LoadingOutlined className="text-gray-400 text-[10px]" />}
      </label>
      <Select
        mode="multiple"
        value={selectedIds}
        onChange={handleChange}
        size="small"
        className="w-full"
        placeholder="选择需要注入的 Skills..."
        maxTagCount="responsive"
        options={skills.map(skill => ({
          value: skill.id,
          label: skill.name,
        }))}
        filterOption={(input, option) =>
          (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
        }
      />
      {selectedIds.length > 0 && (
        <p className="text-[10px] text-gray-400 mt-1.5">
          绑定的 Skills 将在 Agent 执行时作为知识/工具注入到 prompt 中
        </p>
      )}
    </div>
  )
}
