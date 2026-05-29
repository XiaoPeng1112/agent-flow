import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Input, Tooltip, Badge } from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  FolderOutlined,
  DeleteOutlined,
  RocketOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import { AddProjectModal } from './AddProjectModal'
import { UserPanel } from './UserPanel'

/** 从当前 URL pathname 中提取 projectId */
function useCurrentProjectId(): string | undefined {
  const { pathname } = useLocation()
  const match = pathname.match(/^\/projects\/([^/]+)/)
  return match ? match[1] : undefined
}

export function Sidebar() {
  const projects = useAppStore((s) => s.projects)
  const removeProject = useAppStore((s) => s.removeProject)
  const navigate = useNavigate()
  const location = useLocation()
  const currentProjectId = useCurrentProjectId()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.path.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelectProject = (id: string) => {
    navigate(`/projects/${id}/runs`)
  }

  const handleRemoveProject = (id: string, name: string) => {
    if (confirm(`确定删除项目 "${name}" 吗？`)) {
      removeProject(id)
      // 如果删除的是当前选中的项目，导航回首页
      if (currentProjectId === id) {
        navigate('/')
      }
    }
  }

  return (
    <aside className="w-[250px] h-full flex flex-col bg-[#1a1a2e] shrink-0">
      {/* Logo 区域 */}
      <div className="px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <RocketOutlined className="text-white text-[12px]" />
          </div>
          <div>
            <h1 className="text-[14px] font-semibold text-white tracking-tight">AgentFlow</h1>
            <p className="text-[10px] text-slate-500 mt-[-1px]">AI Workflow Engine</p>
          </div>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-3 pt-3 pb-2">
        <Input
          prefix={<SearchOutlined className="text-slate-500" />}
          placeholder="搜索项目..."
          size="small"
          variant="filled"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="!bg-white/5 !border-0 !text-slate-300 placeholder:!text-slate-500 hover:!bg-white/10 focus:!bg-white/10"
          styles={{ input: { color: '#cbd5e1', backgroundColor: 'transparent' } }}
        />
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-2 sidebar-scroll">
        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider px-2 mb-2">
          项目 ({filtered.length})
        </div>

        {filtered.length === 0 && (
          <div className="text-center text-[13px] text-slate-500 py-8">
            {projects.length === 0 ? '暂无项目' : '无匹配结果'}
          </div>
        )}

        <div className="space-y-0.5">
          {filtered.map((project) => {
            const isActive = currentProjectId === project.id
            return (
              <div
                key={project.id}
                onClick={() => handleSelectProject(project.id)}
                className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
                  isActive
                    ? 'bg-indigo-600/20 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <FolderOutlined className={`text-[14px] ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-medium truncate ${isActive ? 'text-white' : ''}`}>
                    {project.name}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {project.path.replace(/^\/Users\/\w+\//, '~/')}
                  </div>
                </div>
                {isActive && (
                  <Badge status="processing" className="mr-1" />
                )}
                <Tooltip title="删除项目" placement="right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveProject(project.id, project.name)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                  >
                    <DeleteOutlined className="text-[12px]" />
                  </button>
                </Tooltip>
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部区域 */}
      <div className="border-t border-white/5">
        {/* 导航链接 */}
        <div className="px-3 pt-3 pb-1 flex flex-col gap-0.5">
          <button
            onClick={() => navigate('/changelog')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] rounded-lg transition-colors ${
              location.pathname === '/changelog'
                ? 'text-white bg-white/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <FileTextOutlined className="text-[13px]" />
            <span>更新日志</span>
          </button>
          <button
            onClick={() => navigate('/about')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] rounded-lg transition-colors ${
              location.pathname === '/about'
                ? 'text-white bg-white/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <InfoCircleOutlined className="text-[13px]" />
            <span>项目介绍</span>
          </button>
        </div>

        {/* 添加项目按钮 */}
        <div className="px-3 py-2">
          <button
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium text-indigo-300 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 rounded-lg transition-colors"
          >
            <PlusOutlined className="text-[11px]" />
            添加项目
          </button>
        </div>

        {/* 用户面板 */}
        <div className="px-3 pb-3">
          <UserPanel />
        </div>
      </div>

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} />}
    </aside>
  )
}
