import { Button, Tag } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { shouldUseDemoMode } from '../demo/mockData'

/**
 * 首页 — 未选中任何项目时显示
 */
export function HomePage() {
  const navigate = useNavigate()
  const projects = useAppStore((s) => s.projects)
  const demoProject = projects.find((project) => project.isDemo)
  const demoMode = shouldUseDemoMode()

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
          <ThunderboltOutlined className="text-3xl text-indigo-500" />
        </div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">AgentFlow</h2>
        <p className="text-sm text-gray-500 mb-1">AI 驱动的多 Agent 协作开发工作流</p>
        <p className="text-xs text-gray-400">
          {demoProject
            ? (demoMode
              ? '先浏览示范项目理解系统形态，后端恢复后即可切回真实数据'
              : '先打开左侧示范项目快速浏览，再决定是否本地部署')
            : '从左侧选择项目开始，或添加新项目'}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Tag color="blue">DAG 编排</Tag>
          <Tag color="purple">多角色 Agent</Tag>
          <Tag color="green">自动化工作流</Tag>
        </div>
        {demoProject && (
          <div className="mt-5">
            <div className="flex items-center justify-center">
              <Button type="primary" onClick={() => navigate(`/projects/${demoProject.id}/runs`)}>
                打开示范项目
              </Button>
            </div>
            {demoMode && (
              <div className="mt-2 text-center text-[11px] text-gray-400">
                后端恢复后会继续显示本地真实项目
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default HomePage
