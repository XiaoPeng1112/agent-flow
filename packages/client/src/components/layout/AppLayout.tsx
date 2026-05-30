import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../sidebar/Sidebar'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { useAppStore } from '../../store/appStore'
import { projectApi, agentApi, templateApi, createWebSocket } from '../../api'
import { useServerStatus } from '../../hooks/useServerStatus'
import {
  DisconnectOutlined,
  LoadingOutlined,
  ReloadOutlined,
} from '@ant-design/icons'

/**
 * 应用根布局
 *
 * 职责：
 *   1. 初始化全局数据（项目列表、Agent 状态、工作流模板）
 *   2. 建立 WebSocket 连接
 *   3. 监测后端服务状态（心跳检测）
 *   4. 提供 Sidebar + 内容区布局结构
 *   5. Outlet 渲染子路由页面
 */
export function AppLayout() {
  const setAgents = useAppStore((s) => s.setAgents)
  const setProjects = useAppStore((s) => s.setProjects)
  const setTemplates = useAppStore((s) => s.setTemplates)
  const handleWsMessage = useAppStore((s) => s.handleWsMessage)
  const serverStatus = useServerStatus()

  useEffect(() => {
    if (serverStatus.status !== 'online') return

    // 服务在线时加载全局初始化数据
    Promise.all([
      agentApi.getStatus().then((res) => setAgents(res.agents)),
      projectApi.list().then((res) =>
        setProjects(res.projects.map((p: any) => ({ ...p, skills: [], runs: [] })))
      ),
      templateApi.list().then((res) => setTemplates(res.templates)),
    ]).catch((err) => console.error('Failed to load initial data:', err))

    // WebSocket 实时通信（带生命周期管理，dispose 后自动停止重连）
    const managedWs = createWebSocket(handleWsMessage)
    return () => { managedWs.dispose() }
  }, [serverStatus.status])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* 深色侧边栏 */}
      <Sidebar serverStatus={serverStatus.status} />

      {/* 右侧内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#f5f6fa]">
        {/* 后端服务离线提示横幅 */}
        {serverStatus.status === 'offline' && (
          <div className="px-4 py-3 bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-100 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <DisconnectOutlined className="text-red-500 text-[14px]" />
                <span className="text-[13px] text-red-700 font-medium">
                  后端服务未连接 — 数据功能不可用
                </span>
              </div>
              <button
                onClick={serverStatus.retry}
                className="flex items-center gap-1.5 px-3 py-1 text-[12px] text-red-600 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
              >
                <ReloadOutlined className="text-[11px]" />
                重试连接
              </button>
            </div>
            <div className="text-[12px] text-red-600/80 leading-relaxed">
              请在终端执行以下命令启动后端服务（需 Node.js 20+）：
            </div>
            <div className="mt-1.5 px-3 py-2 bg-slate-900 rounded-md font-mono text-[11px] text-green-300 leading-[1.8] select-all">
              <div><span className="text-slate-500">$</span> cd ~/Desktop/work/agent-flow</div>
              <div><span className="text-slate-500">$</span> nvm use 20</div>
              <div><span className="text-slate-500">$</span> npm run dev</div>
            </div>
          </div>
        )}

        {/* 连接中提示 */}
        {serverStatus.status === 'connecting' && (
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2.5 shrink-0">
            <LoadingOutlined className="text-blue-500 text-[13px]" />
            <span className="text-[12px] text-blue-600">正在连接后端服务...</span>
          </div>
        )}

        {/* 路由页面（ErrorBoundary 隔离，防止单页面崩溃导致全局白屏） */}
        <ErrorBoundary fallbackTitle="页面加载异常">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
