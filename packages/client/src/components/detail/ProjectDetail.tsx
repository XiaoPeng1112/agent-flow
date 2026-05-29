import { useAppStore } from '../../store/appStore'
import { WorkflowPanel } from './WorkflowPanel'
import { SkillsPanel } from './SkillsPanel'
import { TasksPanel } from './TasksPanel'
import { SettingsPanel } from './SettingsPanel'
import { TaskLogBar } from './TaskLogBar'
import { Workflow, Puzzle, History, Settings } from 'lucide-react'
import type { ProjectTab } from '../../types'

const tabs: { id: ProjectTab; label: string; icon: typeof Workflow }[] = [
  { id: 'workflow', label: '工作流', icon: Workflow },
  { id: 'skills', label: 'Skills', icon: Puzzle },
  { id: 'tasks', label: '任务历史', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
]

export function ProjectDetail() {
  const selectedProjectId = useAppStore((s) => s.selectedProjectId)
  const projects = useAppStore((s) => s.projects)
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)

  const project = projects.find((p) => p.id === selectedProjectId)

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="text-6xl mb-4">🚀</div>
          <h2 className="text-xl font-semibold text-slate-700 mb-2">选择一个项目开始</h2>
          <p className="text-sm text-slate-500">从左侧选择或添加项目，开始 AI 驱动的开发流程</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {/* 项目头部 */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{project.name}</h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{project.path}</p>
          </div>
          {project.description && (
            <span className="text-sm text-slate-500">{project.description}</span>
          )}
        </div>

        {/* Tab 栏 */}
        <div className="flex gap-1 mt-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  activeTab === tab.id
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'workflow' && <WorkflowPanel project={project} />}
        {activeTab === 'skills' && <SkillsPanel project={project} />}
        {activeTab === 'tasks' && <TasksPanel project={project} />}
        {activeTab === 'settings' && <SettingsPanel project={project} />}
      </div>

      {/* 底部任务日志 */}
      <TaskLogBar />
    </div>
  )
}
