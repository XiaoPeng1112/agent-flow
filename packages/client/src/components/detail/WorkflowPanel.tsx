import { Card, Tag, Tooltip } from 'antd'
import {
  ApartmentOutlined,
  BranchesOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import type { Project, WorkflowTemplate } from '../../types'

interface Props {
  project: Project
}

const nodeTypeConfig: Record<string, { color: string; label: string }> = {
  specify: { color: 'blue', label: '需求' },
  design: { color: 'purple', label: '设计' },
  task: { color: 'magenta', label: '拆分' },
  implement: { color: 'green', label: '实现' },
  review: { color: 'orange', label: '审查' },
  test: { color: 'cyan', label: '测试' },
  deliver: { color: 'geekblue', label: '交付' },
  custom: { color: 'default', label: '自定义' },
}

const roleConfig: Record<string, { emoji: string; label: string; color: string }> = {
  planner: { emoji: '🧠', label: '规划者', color: 'purple' },
  manager: { emoji: '📋', label: '管理者', color: 'blue' },
  executor: { emoji: '⚡', label: '执行者', color: 'green' },
}

export function WorkflowPanel({ project: _project }: Props) {
  const templates = useAppStore((s) => s.templates)

  return (
    <div>
      <div className="mb-5">
        <h3 className="text-[15px] font-semibold text-gray-900">工作流模板</h3>
        <p className="text-[12px] text-gray-400 mt-0.5">
          基于 MAF 的 SDD 流程模板设计，支持 DAG 有向无环图编排
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  )
}

function TemplateCard({ template }: { template: WorkflowTemplate }) {
  const hasParallel = template.nodes.some((node) => {
    const outgoing = template.edges.filter((e) => e.source === node.id)
    return outgoing.length > 1
  })

  const layers = buildLayers(template)

  return (
    <Card
      className="!border-gray-200 hover:!border-indigo-300 transition-all !bg-white"
      styles={{ body: { padding: '20px 24px' } }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <ApartmentOutlined className="text-indigo-500 text-[18px]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-[14px] font-semibold text-gray-800">{template.name}</h4>
              {hasParallel && (
                <Tag icon={<BranchesOutlined />} color="purple" className="!text-[10px]">
                  并行
                </Tag>
              )}
            </div>
            <p className="text-[12px] text-gray-400 mt-0.5">{template.description}</p>
          </div>
        </div>
        <Tag className="!text-[11px] !bg-gray-50 !border-gray-200 !text-gray-500">
          {template.nodes.length} 节点
        </Tag>
      </div>

      {/* DAG 流程图 */}
      <div className="bg-gray-50 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {layers.map((layer, layerIdx) => (
            <div key={layerIdx} className="flex items-center gap-2">
              <div className={`flex ${layer.length > 1 ? 'flex-col' : ''} gap-1.5`}>
                {layer.map((nodeId) => {
                  const node = template.nodes.find((n) => n.id === nodeId)
                  if (!node) return null
                  const typeConf = nodeTypeConfig[node.type] || nodeTypeConfig.custom
                  const role = roleConfig[node.agentRole]
                  return (
                    <Tooltip
                      key={node.id}
                      title={
                        <div>
                          <div className="font-medium">{node.name}</div>
                          <div className="text-[11px] opacity-80">{node.description}</div>
                          <div className="text-[11px] mt-1">{role?.emoji} {role?.label}</div>
                        </div>
                      }
                    >
                      <div className="px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm whitespace-nowrap flex items-center gap-1.5 hover:border-indigo-300 hover:shadow transition-all cursor-default">
                        <Tag color={typeConf.color} className="!text-[10px] !m-0 !px-1 !leading-4">
                          {typeConf.label}
                        </Tag>
                        <span className="text-[12px] text-gray-700 font-medium">{node.name}</span>
                      </div>
                    </Tooltip>
                  )
                })}
              </div>
              {layerIdx < layers.length - 1 && (
                <RightOutlined className="text-[12px] text-gray-300 mx-1 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 节点角色统计 */}
      <div className="flex items-center gap-4">
        {Object.entries(roleConfig).map(([role, conf]) => {
          const count = template.nodes.filter((n) => n.agentRole === role).length
          if (count === 0) return null
          return (
            <div key={role} className="flex items-center gap-1.5 text-[12px] text-gray-500">
              <span>{conf.emoji}</span>
              <span>{conf.label}</span>
              <Tag className="!text-[10px] !m-0 !px-1">{count}</Tag>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// 根据 DAG edges 构建层级（拓扑排序分层）
function buildLayers(template: WorkflowTemplate): string[][] {
  const inDegree = new Map<string, number>()
  const adjList = new Map<string, string[]>()

  for (const node of template.nodes) {
    inDegree.set(node.id, 0)
    adjList.set(node.id, [])
  }

  for (const edge of template.edges) {
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

  return layers
}
