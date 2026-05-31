import { useState, useEffect, useCallback, useMemo } from 'react'
import { Tag, Empty, Button, Tooltip, Spin } from 'antd'
import {
  ReloadOutlined, UserOutlined, RobotOutlined,
  CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, BranchesOutlined,
} from '@ant-design/icons'
import { agentApi } from '../../api'
import type { DynamicAgentInstance, Run, AgentRole } from '../../types'

/**
 * AgentTreePanel — Agent Tree 可视化
 * 
 * 参考 MRF §4.6: "主 Agent 在树根 / 子 Agent 按角色和 repo 展开"
 * 
 * 展示 Run 中所有动态 Agent 实例的树形结构：
 * - 根节点: Run（工作流）
 * - 一级子节点: 按角色分组（planner / manager / executor）
 * - 二级子节点: 各动态 Agent 实例
 * 
 * 节点信息包含：实例名称、状态、关联节点、创建时间
 */

interface Props {
  run: Run
}

const ROLE_CONFIG: Record<AgentRole, { label: string; color: string; icon: React.ReactNode }> = {
  planner: { label: '规划层 (Planner)', color: '#6366f1', icon: <UserOutlined /> },
  manager: { label: '管理层 (Manager)', color: '#059669', icon: <BranchesOutlined /> },
  executor: { label: '执行层 (Executor)', color: '#d97706', icon: <ThunderboltOutlined /> },
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  created: { label: '已创建', color: '#6b7280', icon: <ClockCircleOutlined /> },
  active: { label: '执行中', color: '#f59e0b', icon: <ThunderboltOutlined /> },
  completed: { label: '已完成', color: '#10b981', icon: <CheckCircleOutlined /> },
  terminated: { label: '已终止', color: '#ef4444', icon: <CloseCircleOutlined /> },
}

export function AgentTreePanel({ run }: Props) {
  const [instances, setInstances] = useState<DynamicAgentInstance[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set(['planner', 'manager', 'executor']))

  const loadInstances = useCallback(async () => {
    setLoading(true)
    try {
      const { instances: data } = await agentApi.getInstances(run.id)
      setInstances(data || [])
    } catch {
      setInstances([])
    } finally {
      setLoading(false)
    }
  }, [run.id])

  useEffect(() => { loadInstances() }, [loadInstances])

  // 按角色分组
  const groupedByRole = useMemo(() => {
    const groups: Record<AgentRole, DynamicAgentInstance[]> = {
      planner: [],
      manager: [],
      executor: [],
    }
    for (const inst of instances) {
      if (groups[inst.role]) {
        groups[inst.role].push(inst)
      }
    }
    return groups
  }, [instances])

  const toggleRole = (role: string) => {
    setExpandedRoles(prev => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  const getNodeName = (nodeId: string) => {
    const node = run.nodes.find(n => n.id === nodeId)
    return node?.name || nodeId
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const totalActive = instances.filter(i => i.status === 'active').length
  const totalCompleted = instances.filter(i => i.status === 'completed').length

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RobotOutlined className="text-purple-500" />
          <span className="text-sm font-medium text-gray-700">Agent Tree</span>
          <Tag color="purple" className="text-[10px]">{instances.length} 实例</Tag>
          {totalActive > 0 && <Tag color="warning" className="text-[10px]">{totalActive} 活跃</Tag>}
          {totalCompleted > 0 && <Tag color="success" className="text-[10px]">{totalCompleted} 完成</Tag>}
        </div>
        <Button size="small" icon={<ReloadOutlined />} onClick={loadInstances} loading={loading}>
          刷新
        </Button>
      </div>

      {/* 树形内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && instances.length === 0 ? (
          <div className="flex justify-center py-12"><Spin /></div>
        ) : instances.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div className="text-center">
                <p className="text-[12px] text-gray-400 mb-1">暂无动态 Agent 实例</p>
                <p className="text-[11px] text-gray-300">当节点开始执行时，系统会动态创建 Agent 实例</p>
              </div>
            }
          />
        ) : (
          <div className="space-y-1">
            {/* 根节点: Run */}
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-50/60 rounded-lg border border-purple-100/60 mb-3">
              <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center">
                <BranchesOutlined className="text-purple-500 text-[11px]" />
              </div>
              <div className="flex-1">
                <div className="text-[12px] font-medium text-purple-700">{run.name}</div>
                <div className="text-[10px] text-purple-400">
                  工作流根 · {instances.length} 个 Agent 实例
                </div>
              </div>
            </div>

            {/* 角色分组 */}
            {(Object.entries(groupedByRole) as [AgentRole, DynamicAgentInstance[]][]).map(([role, roleInstances]) => {
              const config = ROLE_CONFIG[role]
              const isExpanded = expandedRoles.has(role)

              return (
                <div key={role} className="ml-4">
                  {/* 角色组头部 */}
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleRole(role)}
                  >
                    {/* 连接线 */}
                    <div className="w-4 h-px border-t border-dashed border-gray-200" />
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-white"
                      style={{ backgroundColor: config.color }}
                    >
                      {config.icon}
                    </div>
                    <span className="text-[11px] font-medium" style={{ color: config.color }}>
                      {config.label}
                    </span>
                    <Tag className="text-[10px] !px-1.5 !py-0" color="default">
                      {roleInstances.length}
                    </Tag>
                    <span className="text-[10px] text-gray-300 ml-auto">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>

                  {/* 实例列表 */}
                  {isExpanded && (
                    <div className="ml-6 mt-1 space-y-1">
                      {roleInstances.length === 0 ? (
                        <div className="px-3 py-1.5 text-[10px] text-gray-300 italic">暂无实例</div>
                      ) : (
                        roleInstances.map((inst) => {
                          const statusCfg = STATUS_CONFIG[inst.status] || STATUS_CONFIG.created
                          return (
                            <div
                              key={inst.id}
                              className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-50/50 border border-gray-100/60 hover:border-gray-200 transition-colors"
                            >
                              {/* 连接线 */}
                              <div className="w-3 h-px border-t border-dotted border-gray-200" />
                              {/* 状态图标 */}
                              <Tooltip title={statusCfg.label}>
                                <span style={{ color: statusCfg.color }} className="text-[11px]">
                                  {statusCfg.icon}
                                </span>
                              </Tooltip>
                              {/* 实例信息 */}
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] text-gray-700 truncate font-medium">
                                  {inst.name}
                                </div>
                                <div className="text-[10px] text-gray-400 flex items-center gap-2">
                                  <span>节点: {getNodeName(inst.nodeId)}</span>
                                  <span>·</span>
                                  <span>{formatTime(inst.createdAt)}</span>
                                  {inst.terminatedAt && (
                                    <>
                                      <span>→</span>
                                      <span>{formatTime(inst.terminatedAt)}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              {/* 状态标签 */}
                              <Tag
                                className="text-[9px] !px-1.5 !py-0 !m-0"
                                color={statusCfg.color}
                                bordered={false}
                              >
                                {statusCfg.label}
                              </Tag>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
