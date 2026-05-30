import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { Tabs, Tag } from 'antd'
import {
  ThunderboltOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../store/appStore'
import { RunsPanel } from '../components/detail/RunsPanel'
import { WorkflowPanel } from '../components/detail/WorkflowPanel'
import { SkillsPanel } from '../components/detail/SkillsPanel'
import { AgentsPanel } from '../components/detail/AgentsPanel'
import { SettingsPanel } from '../components/detail/SettingsPanel'
import { TaskLogBar } from '../components/detail/TaskLogBar'
import type { ProjectTab } from '../types'

const VALID_TABS: ProjectTab[] = ['runs', 'workflow', 'skills', 'agents', 'settings']

const tabItems = [
  { key: 'runs' as ProjectTab, label: 'Runs', icon: <ThunderboltOutlined /> },
  { key: 'workflow' as ProjectTab, label: '工作流模板', icon: <ApartmentOutlined /> },
  { key: 'skills' as ProjectTab, label: 'Skills', icon: <AppstoreOutlined /> },
  { key: 'agents' as ProjectTab, label: 'Agents', icon: <RobotOutlined /> },
  { key: 'settings' as ProjectTab, label: '设置', icon: <SettingOutlined /> },
]

/**
 * 项目详情页
 *
 * URL: /projects/:projectId/:tab
 * 从 URL params 中获取 projectId 和当前 tab，完全由路由驱动。
 */
export function ProjectPage() {
  const { projectId, tab } = useParams<{ projectId: string; tab: string }>()
  const navigate = useNavigate()
  const projects = useAppStore((s) => s.projects)

  // 验证 tab 合法性
  const activeTab = (tab && VALID_TABS.includes(tab as ProjectTab))
    ? (tab as ProjectTab)
    : 'runs'

  // 如果 tab 不合法，重定向到 runs
  if (tab && !VALID_TABS.includes(tab as ProjectTab)) {
    return <Navigate to={`/projects/${projectId}/runs`} replace />
  }

  const project = projects.find((p) => p.id === projectId)

  // 项目未加载完成时的 loading 态
  if (projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-400">加载中...</div>
      </div>
    )
  }

  // 项目不存在
  if (!project) {
    return <Navigate to="/" replace />
  }

  const handleTabChange = (key: string) => {
    navigate(`/projects/${projectId}/${key}`)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 项目头部信息 */}
      <div className="bg-white border-b border-gray-100/80 px-7 pt-5 pb-0 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-[13px] shadow-sm">
              {project.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900 leading-tight">{project.name}</h2>
              <p className="text-[11px] text-gray-400 font-mono mt-0.5">{project.path.replace(/^\/Users\/\w+\//, '~/')}</p>
            </div>
          </div>
          {project.description && (
            <Tag className="!text-[11px] !border-0 !bg-gray-50 !text-gray-500 !rounded-md">
              {project.description}
            </Tag>
          )}
        </div>

        {/* Tab 栏 */}
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={tabItems.map((t) => ({
            key: t.key,
            label: (
              <span className="flex items-center gap-1.5 text-[13px]">
                {t.icon}
                {t.label}
              </span>
            ),
          }))}
          className="!mb-0 project-tabs"
          size="middle"
        />
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-[#f5f6fa]">
        {activeTab === 'runs' && <RunsPanel project={project} />}
        {activeTab === 'workflow' && <WorkflowPanel project={project} />}
        {activeTab === 'skills' && <SkillsPanel project={project} />}
        {activeTab === 'agents' && <AgentsPanel project={project} />}
        {activeTab === 'settings' && <SettingsPanel project={project} />}
      </div>

      {/* 底部任务日志 */}
      <TaskLogBar />
    </div>
  )
}

export default ProjectPage
