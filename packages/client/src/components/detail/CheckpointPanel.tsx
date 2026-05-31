import { useState, useEffect, useCallback } from 'react'
import {
  Tag, Empty, Button, Tooltip, Spin, Modal, Input, Timeline, Alert,
} from 'antd'
import {
  ReloadOutlined, SaveOutlined, UndoOutlined,
  CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined, HeartOutlined,
} from '@ant-design/icons'
import { robustnessApi } from '../../api'
import { useAppStore } from '../../store/appStore'
import type { Run } from '../../types'

/**
 * CheckpointPanel — Checkpoint 恢复与系统健壮性管理
 * 
 * 功能：
 * 1. 查看所有 Checkpoint 列表（时间线展示）
 * 2. 手动创建 Checkpoint
 * 3. 恢复到指定 Checkpoint（需确认）
 * 4. 系统健康状态概览
 */

interface Props {
  run: Run
}

interface Checkpoint {
  id: string
  runId: string
  snapshotAt: number
  nodeStates: Array<{ nodeId: string; status: string }>
  description?: string
}

interface HealthStatus {
  deadLetterCount: number
  pendingRetries: number
  totalCheckpoints: number
  auditLogSize: number
  status: 'healthy' | 'degraded' | 'critical'
}

export function CheckpointPanel({ run }: Props) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [description, setDescription] = useState('')

  const updateRun = useAppStore((s) => s.updateRun)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cpRes, healthRes] = await Promise.all([
        robustnessApi.getCheckpoints(run.id),
        robustnessApi.getHealth(),
      ])
      setCheckpoints(cpRes.checkpoints || [])
      setHealth(healthRes)
    } catch {
      setCheckpoints([])
    } finally {
      setLoading(false)
    }
  }, [run.id])

  useEffect(() => { loadData() }, [loadData])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await robustnessApi.createCheckpoint(run.id, description || undefined)
      setCheckpoints((prev) => [...prev, res.checkpoint])
      setCreateModalOpen(false)
      setDescription('')
    } catch {
      // error handled
    } finally {
      setCreating(false)
    }
  }

  const handleRestore = (checkpointId: string) => {
    Modal.confirm({
      title: '确认恢复',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>恢复到此 Checkpoint 后，所有在该时间点之后的执行进度将丢失。</p>
          <p className="mt-2 text-orange-600 text-[12px]">此操作不可撤销，确认继续？</p>
        </div>
      ),
      okText: '确认恢复',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setRestoring(checkpointId)
        try {
          const res = await robustnessApi.restoreCheckpoint(run.id, checkpointId)
          updateRun(res.run)
          await loadData()
        } finally {
          setRestoring(null)
        }
      },
    })
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const getNodeName = (nodeId: string) => {
    const node = run.nodes.find(n => n.id === nodeId)
    return node?.name || nodeId
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10b981'
      case 'running': return '#f59e0b'
      case 'failed': return '#ef4444'
      case 'ready': return '#3b82f6'
      default: return '#9ca3af'
    }
  }

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      completed: '已完成',
      running: '执行中',
      failed: '失败',
      ready: '就绪',
      pending: '等待中',
      skipped: '已跳过',
      wait_user_review: '待验收',
    }
    return map[status] || status
  }

  const healthColor = health?.status === 'healthy' ? '#10b981' : health?.status === 'degraded' ? '#f59e0b' : '#ef4444'
  const healthLabel = health?.status === 'healthy' ? '系统正常' : health?.status === 'degraded' ? '性能降级' : '严重异常'

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <HistoryOutlined className="text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">Checkpoint 恢复</span>
          <Tag color="purple" className="text-[10px]">{checkpoints.length} 快照</Tag>
        </div>
        <div className="flex items-center gap-2">
          <Button size="small" icon={<SaveOutlined />} onClick={() => setCreateModalOpen(true)}>
            创建快照
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadData} loading={loading}>
            刷新
          </Button>
        </div>
      </div>

      {/* 系统健康状态 */}
      {health && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-lg border" style={{ borderColor: `${healthColor}40`, backgroundColor: `${healthColor}08` }}>
          <div className="flex items-center gap-2 mb-1.5">
            <HeartOutlined style={{ color: healthColor }} className="text-[12px]" />
            <span className="text-[11px] font-medium" style={{ color: healthColor }}>{healthLabel}</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-500">
            <span>死信队列: {health.deadLetterCount}</span>
            <span>待重试: {health.pendingRetries}</span>
            <span>Checkpoint: {health.totalCheckpoints}</span>
            <span>审计日志: {health.auditLogSize}</span>
          </div>
        </div>
      )}

      {/* Checkpoint 时间线 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && checkpoints.length === 0 ? (
          <div className="flex justify-center py-12"><Spin /></div>
        ) : checkpoints.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div className="text-center">
                <p className="text-[12px] text-gray-400 mb-1">暂无 Checkpoint</p>
                <p className="text-[11px] text-gray-300">
                  点击"创建快照"保存当前 Run 的状态，以便在需要时恢复
                </p>
              </div>
            }
          />
        ) : (
          <Timeline
            items={[...checkpoints].reverse().map((cp) => {
              const completedCount = cp.nodeStates.filter(ns => ns.status === 'completed').length
              const totalNodes = cp.nodeStates.length
              const isRestoring = restoring === cp.id

              return {
                color: completedCount === totalNodes ? 'green' : 'blue',
                dot: completedCount === totalNodes ? <CheckCircleOutlined /> : <ClockCircleOutlined />,
                children: (
                  <div className="pb-2">
                    {/* Checkpoint 头部 */}
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="text-[12px] font-medium text-gray-700">
                          {cp.description || `快照 ${cp.id.slice(5, 13)}`}
                        </span>
                        <span className="text-[10px] text-gray-400 ml-2">
                          {formatTime(cp.snapshotAt)}
                        </span>
                      </div>
                      <Tooltip title="恢复到此快照">
                        <Button
                          size="small"
                          icon={<UndoOutlined />}
                          onClick={() => handleRestore(cp.id)}
                          loading={isRestoring}
                          className="!text-[10px]"
                          danger
                        >
                          恢复
                        </Button>
                      </Tooltip>
                    </div>

                    {/* 节点状态摘要 */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-gray-400">
                        {completedCount}/{totalNodes} 已完成
                      </span>
                      <span className="text-[10px] text-gray-300">·</span>
                      {cp.nodeStates.slice(0, 6).map((ns) => (
                        <Tooltip key={ns.nodeId} title={`${getNodeName(ns.nodeId)}: ${getStatusLabel(ns.status)}`}>
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: getStatusColor(ns.status) }}
                          />
                        </Tooltip>
                      ))}
                      {cp.nodeStates.length > 6 && (
                        <span className="text-[9px] text-gray-400">+{cp.nodeStates.length - 6}</span>
                      )}
                    </div>
                  </div>
                ),
              }
            })}
          />
        )}

        {/* 提示 */}
        {checkpoints.length > 0 && (
          <Alert
            type="info"
            showIcon
            className="!text-[11px] mt-4"
            message="恢复说明"
            description="恢复到 Checkpoint 会将所有节点状态回退到快照时刻。已完成的产出物不会被删除，但后续节点的执行结果将需要重新生成。"
          />
        )}
      </div>

      {/* 创建 Checkpoint Modal */}
      <Modal
        title="创建 Checkpoint"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => { setCreateModalOpen(false); setDescription('') }}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
      >
        <div className="py-2">
          <p className="text-[12px] text-gray-500 mb-3">
            创建当前 Run 的状态快照。如果后续执行出现问题，可以恢复到此时刻的状态。
          </p>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="（可选）描述此快照，例如：完成设计阶段，准备进入开发"
            rows={3}
            className="!text-[12px]"
          />
          <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg">
            <p className="text-[11px] text-gray-500 font-medium mb-1">当前状态预览：</p>
            <div className="flex items-center gap-2 flex-wrap">
              {run.nodes.map((n) => (
                <Tooltip key={n.id} title={`${n.name}: ${getStatusLabel(n.status)}`}>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white rounded border border-gray-100">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(n.status) }} />
                    <span className="text-[9px] text-gray-500 max-w-[60px] truncate">{n.name}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
