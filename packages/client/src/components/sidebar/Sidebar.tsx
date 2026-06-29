import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Input, Tooltip, Badge, App } from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  FolderOutlined,
  DeleteOutlined,
  RocketOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
  ApartmentOutlined,
  SettingOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import { projectApi, authApi } from '../../api'
import { AddProjectModal } from './AddProjectModal'
import { UserPanel } from './UserPanel'
import { SyncPanel } from './SyncPanel'
import type { ServerStatus } from '../../hooks/useServerStatus'

/** 从当前 URL pathname 中提取 projectId */
function useCurrentProjectId(): string | undefined {
  const { pathname } = useLocation()
  const match = pathname.match(/^\/projects\/([^/]+)/)
  return match ? match[1] : undefined
}

interface SidebarProps {
  serverStatus: ServerStatus
  demoMode: boolean
}

export function Sidebar({ serverStatus, demoMode }: SidebarProps) {
  const projects = useAppStore((s) => s.projects)
  const removeProject = useAppStore((s) => s.removeProject)
  const navigate = useNavigate()
  const location = useLocation()
  const currentProjectId = useCurrentProjectId()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const { message } = App.useApp()

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.path.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelectProject = (id: string) => {
    navigate(`/projects/${id}/runs`)
  }

  const handleRemoveProject = async (id: string, name: string) => {
    if (demoMode) {
      message.info('Demo 项目为只读示范，不能删除')
      return
    }
    if (confirm(`确定删除项目 "${name}" 吗？`)) {
      try {
        await projectApi.delete(id)
        removeProject(id)
        message.success(`项目 "${name}" 已删除`)
        // 如果删除的是当前选中的项目，导航回首页
        if (currentProjectId === id) {
          navigate('/')
        }
      } catch (err: any) {
        message.error(`删除失败: ${err.message}`)
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
                  <div className="text-[11px] text-slate-500 truncate mt-0.5 flex items-center gap-1.5">
                    <span>{project.path.replace(/^\/Users\/\w+\//, '~/')}</span>
                    {project.isDemo && (
                      <span className="px-1 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[10px] leading-none">
                        Demo
                      </span>
                    )}
                  </div>
                </div>
                {isActive && (
                  <Badge status="processing" className="mr-1" />
                )}
                {!project.isDemo && (
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
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部区域 */}
      <div className="border-t border-white/5">
        {/* Context DB 导航 */}
        <div className="px-3 pt-3 pb-1 flex flex-col gap-0.5">
          <button
            onClick={() => navigate('/context-db/sys')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] rounded-lg transition-colors ${
              location.pathname === '/context-db/sys'
                ? 'text-white bg-white/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <SafetyCertificateOutlined className="text-[13px]" />
            <span>Context DB · SYS</span>
          </button>
          <button
            onClick={() => navigate('/context-db/l1')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] rounded-lg transition-colors ${
              location.pathname === '/context-db/l1'
                ? 'text-white bg-white/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <ApartmentOutlined className="text-[13px]" />
            <span>Context DB · L1</span>
          </button>
        </div>

        {/* 账号/同步/其他 — 可折叠 */}
        <CollapsibleMoreSection navigate={navigate} location={location} />

        {/* 添加项目按钮 */}
        <div className="px-3 py-2">
          <button
            onClick={() => {
              if (demoMode) {
                message.info('Demo 模式下不可添加项目，请在本地启动后端后使用真实数据')
                return
              }
              setShowAdd(true)
            }}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium border rounded-lg transition-colors ${
              demoMode
                ? 'text-slate-400 bg-white/5 border-white/10'
                : 'text-indigo-300 bg-indigo-600/10 hover:bg-indigo-600/20 border-indigo-500/20'
            }`}
          >
            <PlusOutlined className="text-[11px]" />
            {demoMode ? '示范模式只读' : '添加项目'}
          </button>
        </div>

        {/* 服务状态指示 */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/5">
            <div className={`w-2 h-2 rounded-full ${
              demoMode
                ? 'bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.6)]'
                : serverStatus === 'online'
                  ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]'
                  : serverStatus === 'connecting'
                    ? 'bg-blue-400 animate-pulse'
                    : 'bg-red-400'
            }`} />
            <span className="text-[11px] text-slate-500">
              {demoMode && 'Demo Mode · 使用内置示范数据'}
              {!demoMode && serverStatus === 'online' && '后端服务运行中 · localhost:3001'}
              {!demoMode && serverStatus === 'connecting' && '正在连接后端服务...'}
              {!demoMode && serverStatus === 'offline' && '后端服务未连接'}
            </span>
          </div>
        </div>
      </div>

      {showAdd && <AddProjectModal onClose={() => setShowAdd(false)} />}
    </aside>
  )
}

/** 可折叠的更多功能区域（同步、更新日志、项目介绍） */
function CollapsibleMoreSection({ navigate, location }: { navigate: (path: string) => void; location: { pathname: string } }) {
  const [expanded, setExpanded] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    let cancelled = false

    authApi.me()
      .then((res) => {
        if (cancelled) return
        setAuthorized(
          res.authenticated &&
          res.user?.login?.toLowerCase() === 'xiaopeng1112'
        )
      })
      .catch(() => {
        if (!cancelled) {
          setAuthorized(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="px-3 py-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
      >
        <SettingOutlined className="text-[13px]" />
        <span className="flex-1 text-left">更多</span>
        <DownOutlined className={`text-[10px] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="flex flex-col gap-0.5 pt-1">
          <UserPanel />
          <SyncPanel />
          {authorized && (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
