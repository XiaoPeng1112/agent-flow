import { useState } from 'react'
import { FolderOpen, Plus, Trash2, Search } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { AddProjectModal } from './AddProjectModal'

export function ProjectList() {
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore((s) => s.selectedProjectId)
  const selectProject = useAppStore((s) => s.selectProject)
  const removeProject = useAppStore((s) => s.removeProject)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.path.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <aside className="w-64 h-full flex flex-col border-r border-slate-200 bg-white">
      {/* 头部 */}
      <div className="p-4 border-b border-slate-100">
        <h1 className="text-lg font-semibold text-slate-800">AgentFlow</h1>
        <p className="text-xs text-slate-500 mt-0.5">AI 工作流管理平台</p>
      </div>

      {/* 搜索 */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="搜索项目..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-8">
            {projects.length === 0 ? '暂无项目，点击下方添加' : '无匹配项目'}
          </div>
        )}
        {filtered.map((project) => (
          <div
            key={project.id}
            onClick={() => selectProject(project.id)}
            className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer mb-1 transition-colors ${
              selectedProjectId === project.id
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'hover:bg-slate-50 text-slate-700'
            }`}
          >
            <FolderOpen className="w-4 h-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{project.name}</div>
              <div className="text-xs text-slate-400 truncate">{project.path}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`确定删除项目 "${project.name}" 吗？`)) {
                  removeProject(project.id)
                }
              }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* 添加项目按钮 */}
      <div className="p-3 border-t border-slate-100">
        <button
          onClick={() => setShowAdd(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加项目
        </button>
      </div>

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} />}
    </aside>
  )
}
