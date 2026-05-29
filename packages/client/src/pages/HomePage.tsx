import { Tag } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'

/**
 * 首页 — 未选中任何项目时显示
 */
export function HomePage() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
          <ThunderboltOutlined className="text-3xl text-indigo-500" />
        </div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">AgentFlow</h2>
        <p className="text-sm text-gray-500 mb-1">AI 驱动的多 Agent 协作开发工作流</p>
        <p className="text-xs text-gray-400">从左侧选择项目开始，或添加新项目</p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Tag color="blue">DAG 编排</Tag>
          <Tag color="purple">多角色 Agent</Tag>
          <Tag color="green">自动化工作流</Tag>
        </div>
      </div>
    </div>
  )
}
